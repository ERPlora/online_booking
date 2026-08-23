//! Handlers WASM (Tier 2) del módulo `online_booking`.
//!
//! `create_booking` — el pre-check legible delante de la gate (online_booking#25). El módulo
//! es declarativo: la ventana de reserva la impone el `WHERE` de `commands/booking_create.sql`
//! y la gate `expect_rows` (ANCLADA al INSERT desde hub#1091) la convierte en un rechazo
//! `online_booking.outside_booking_window` que revierte el lote entero — contador de
//! referencias incluido. Lo que el SQL NO puede distinguir es POR QUÉ el INSERT no escribió:
//! sin fila de ajustes el hub no tiene ventana que aplicar, y «este negocio nunca configuró su
//! página de reservas» y «ese hueco queda fuera de la ventana» son fallos de operar distintos
//! que no pueden compartir mensaje. Esa mitad vive aquí, sobre la lectura pre-cargada
//! (`reads`, ADR-0069): sin fila de ajustes el command se rechaza con
//! `online_booking.settings_missing` ANTES de tocar la BD — sin reserva fantasma, sin número
//! quemado, sin evento de algo que no ocurrió.
//!
//! El handler no valida el payload (lo hace el schema del command en el dispatcher) ni genera
//! ids (la autoridad es el host: `new_ids[0]` es la nueva reserva, y se pasa como
//! `booking_id` a la intención para que la respuesta del command lo reporte). Lo que devuelve
//! es una **intención**: `online_booking._booking_create`, el command interno que lleva el
//! bump del contador + el INSERT — misma transacción, misma gate anclada.

use erplora_guest_sdk::{DomainError, Operation, Output};
use serde_json::{Map, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

#[cfg(feature = "guest")]
fn guest_err(msg: String) -> WithReturnCode<Error> {
    WithReturnCode::new(Error::msg(msg), 1)
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn create_booking(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    create_booking_pure(input.into_inner().into_value()).map(Json).map_err(guest_err)
}

// ── helpers puros ────────────────────────────────────────────────────────────

fn read_rows<'a>(input: &'a Value, query: &str) -> Option<&'a Vec<Value>> {
    input
        .pointer("/context/reads")
        .and_then(|r| r.get(query))
        .and_then(|v| v.as_array())
}

pub const SETTINGS_QUERY: &str = "online_booking.settings.get";
pub const SETTINGS_MISSING: &str = "online_booking.settings_missing";
pub const SETTINGS_UNREADABLE: &str = "online_booking.settings_unreadable";
pub const CREATE_INTENT: &str = "online_booking._booking_create";

/// La decisión de online_booking#25: el pre-check de ajustes, delante de la gate SQL.
///
/// Recibe el input completo del host y el payload ya defaulteado por el schema; devuelve la
/// intención a ejecutar, o el rechazo de dominio con el que el command contesta.
pub fn create_booking_pure(input: Value) -> Result<Output, String> {
    let payload = input
        .pointer("/payload")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let booking_id = input
        .pointer("/context/new_ids/0")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("context.new_ids vacío: el host no entregó ids")?
        .to_string();

    // online_booking#25 — the settings pre-check, decided BEFORE any SQL runs. The read the
    // manifest declares (`reads`, required) is the authority: `online_booking.settings.get`
    // delivers the hub's settings row, or an EMPTY list when the hub has none (the query
    // filters `is_deleted = 0`, so a soft-deleted row is a missing one too). An absent read
    // (a runtime that did not preload it) must not degrade into a guess: a guard that guesses
    // when its input is missing is a guard that opens (same rule as reservations#31/#32).
    let rows = read_rows(&input, SETTINGS_QUERY);
    let has_settings = rows.is_some_and(|rows| !rows.is_empty());
    if !has_settings {
        let error = if rows.is_some() {
            DomainError::new(
                SETTINGS_MISSING,
                "This business has not set up its booking page yet, so no booking can be \
                 accepted. Configure the booking settings first.",
            )
        } else {
            DomainError::new(
                SETTINGS_UNREADABLE,
                "The booking settings could not be read, so nothing was booked. Try again.",
            )
        };
        return Ok(Output::new().with_error(error));
    }

    let mut params = match payload {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    params.insert("booking_id".into(), Value::String(booking_id));

    Ok(Output {
        operations: vec![Operation::sql(CREATE_INTENT, params)],
        events: Vec::new(),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(reads: Value, payload: Value) -> Value {
        json!({
            "payload": payload,
            "context": {
                "hub_id": "hub-1",
                "current_user_id": "u-1",
                "now": "2026-08-22T12:00:00Z",
                "new_ids": ["bk-1"],
                "reads": reads,
            }
        })
    }

    /// `reads` keyed by query name — `json!` only takes literal keys, so the map is built.
    fn settings_read(rows: Value) -> Value {
        let mut m = Map::new();
        m.insert(SETTINGS_QUERY.to_string(), rows);
        Value::Object(m)
    }

    /// The payload the dispatcher hands over: schema-validated AND schema-defaulted
    /// (decision-log 2026-06-25) — absent optionals arrive as their defaults, not as holes.
    fn defaulted_payload() -> Value {
        json!({
            "customer_id": null,
            "customer_name": "Bar Pepe",
            "customer_email": "pepe@example.com",
            "customer_phone": "+34 600 000 001",
            "service_id": null,
            "service_name": "Mesa terraza",
            "staff_id": null,
            "staff_name": "",
            "booking_date": "2026-08-23",
            "booking_time": "15:00",
            "duration_minutes": 60,
            "booking_type": "table_reservation",
            "notes": ""
        })
    }

    fn one_settings_row() -> Value {
        settings_read(json!([{ "id": "st-1", "is_enabled": 1, "min_advance_hours": 2, "max_advance_days": 30 }]))
    }

    // ── online_booking#25: the settings pre-check ──────────────────────────────

    /// THE case of the issue: a hub with NO settings row must not reach the SQL at all —
    /// before the fix the INSERT…SELECT wrote zero rows, the counter's UPSERT satisfied the
    /// batch-sum gate, and the command answered ok over a booking that was never saved.
    #[test]
    fn settings_missing_refuses_before_any_sql() {
        let out = create_booking_pure(input(settings_read(json!([])), defaulted_payload()))
            .expect("pure handler never traps on a business refusal");
        let error = out.error.expect("a hub without settings must be refused");
        assert_eq!(error.code, SETTINGS_MISSING);
        assert!(
            !error.message.is_empty(),
            "the fallback sentence must say what the operator should do"
        );
        assert!(out.operations.is_empty(), "no intent may run: nothing was booked");
        assert!(out.events.is_empty(), "no event for a booking that does not exist");
    }

    /// A settings row soft-deleted (`is_deleted = 1`) is filtered out by the settings query,
    /// so the read delivers an EMPTY list — the same refusal as no row at all.
    #[test]
    fn a_deleted_settings_row_is_a_missing_one() {
        let out = create_booking_pure(input(settings_read(json!([])), defaulted_payload()))
            .expect("pure handler never traps");
        assert_eq!(out.error.expect("refused").code, SETTINGS_MISSING);
    }

    /// The read itself not delivered (a runtime that does not preload it, or a degraded one):
    /// the guard must not GUESS a window it could not read — a guard that guesses when its
    /// input is missing is a guard that opens (same rule as reservations#31/#32).
    #[test]
    fn an_undelivered_read_refuses_to_guess() {
        let out = create_booking_pure(input(json!({}), defaulted_payload()))
            .expect("pure handler never traps");
        let error = out.error.expect("missing reads must be refused");
        assert_eq!(error.code, SETTINGS_UNREADABLE);
        assert!(out.operations.is_empty());
    }

    // ── the intent the handler emits when the pre-check passes ─────────────────

    #[test]
    fn with_settings_it_emits_the_create_intent_once() {
        let out = create_booking_pure(input(one_settings_row(), defaulted_payload()))
            .expect("pure handler never traps");
        assert!(out.error.is_none());
        assert_eq!(out.operations.len(), 1);
        let op = &out.operations[0];
        assert_eq!(op.command, CREATE_INTENT);
        assert_eq!(op.params.get("booking_id"), Some(&json!("bk-1")));
    }

    /// The booking row's id must be the host-minted one (`new_ids[0]`), so the command's
    /// response reports the id of the row it created (hub#776: `consumed_new_ids` scans the
    /// intent params).
    #[test]
    fn the_booking_id_comes_from_the_host_batch() {
        let mut inp = input(one_settings_row(), defaulted_payload());
        inp["context"]["new_ids"] = json!(["bk-9", "bk-10"]);
        let out = create_booking_pure(inp).expect("pure handler never traps");
        assert_eq!(out.operations[0].params.get("booking_id"), Some(&json!("bk-9")));
    }

    /// The payload passes through untouched (the dispatcher already validated and defaulted
    /// it against the command's schema) — plus the `booking_id` the host minted.
    #[test]
    fn the_defaulted_payload_passes_through_unchanged() {
        let out = create_booking_pure(input(one_settings_row(), defaulted_payload()))
            .expect("pure handler never traps");
        let mut expected = defaulted_payload();
        expected["booking_id"] = json!("bk-1");
        assert_eq!(serde_json::to_value(&out.operations[0].params).unwrap(), expected);
    }

    /// No host-minted ids is a broken HOST contract (§5.3), not a business refusal: it traps,
    /// like every handler in the fleet does.
    #[test]
    fn an_empty_host_id_batch_traps() {
        let mut inp = input(one_settings_row(), defaulted_payload());
        inp["context"]["new_ids"] = json!([]);
        assert!(create_booking_pure(inp).is_err());
    }
}
