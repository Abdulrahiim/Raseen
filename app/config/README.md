# config/ — NAJM-3000 Digital Twin Configuration

> **Classification: RESTRICTED — Internal Use Only**

## Purpose

This directory contains YAML configuration files for the NAJM-3000 Digital Twin.

---

## Structure

| File | Description | Committed |
|---|---|---|
| `project.example.yaml` | Project location, timezone, and plant metadata | ✅ Yes (placeholder values) |
| `equipment.example.yaml` | Multi-vendor equipment parameter library | ✅ Yes (placeholder values) |
| `blocks.example.yaml` | MV block configuration and vendor assignments | ✅ Yes (placeholder values) |
| `data_sources.example.yaml` | Weather and data source configuration | ✅ Yes (placeholder values) |
| `project.yaml` | **Actual** project configuration (not committed) | ❌ No — gitignored |
| `blocks.yaml` | **Actual** block configuration (not committed) | ❌ No — gitignored |
| `equipment.yaml` | **Actual** equipment parameters (not committed) | ❌ No — gitignored |
| `data_sources.yaml` | **Actual** data source configuration (not committed) | ❌ No — gitignored |

---

## Conventions

### Units

All parameter values are in **SI units** unless explicitly noted:

| Quantity | Unit |
|---|---|
| Power | W (watts) |
| Energy | Wh (watt-hours) |
| Voltage | V (volts) |
| Current | A (amperes) |
| Resistance | Ω (ohms) |
| Temperature | °C (degrees Celsius) |
| Temperature coefficient | per °C (fraction per °C) |
| Length | m (metres) |
| Area | m² |
| Irradiance | W/m² |
| Angle | degrees |
| Fraction | dimensionless (0.0 to 1.0) |
| Pressure | Pa (pascals) |

Angles are in degrees unless the pvlib function requires radians.

### Provenance

Every parameter in a live configuration file must carry a `provenance:` block:

```yaml
parameter_name:
  value: 1234.5
  unit: "W"
  provenance:
    source_id: "SRC-001"
    source_section: "Section 3.2"
    source_page: "12"
    data_quality_status: "Provisional"
    confidence: "Medium"
    date_extracted: "2026-07-21"
    notes: "Value from design basis; not confirmed as installed"
```

Parameters without provenance blocks must use an assumption ID:

```yaml
parameter_name:
  value: 0.70
  unit: "—"
  provenance:
    assumption_id: "ASMP-003"
    data_quality_status: "Assumed"
    confidence: "Low"
```

### Placeholder Values

All values in `*.example.yaml` files are **clearly marked as placeholder or
provisional**. They must not be used as engineering-quality inputs without
review and confirmation from source documents.

---

## Adding a New Configuration

1. Copy the relevant `*.example.yaml` to a new `*.yaml` (not committed).
2. Replace all `PLACEHOLDER` values with confirmed engineering values.
3. Add provenance blocks for every parameter.
4. Update `ASSUMPTIONS_REGISTER.md` for any assumed values.
5. Run `python -m najm3000.config.validate --config config/project.yaml` to
   validate the schema before running the model.

---

*NAJM-3000 Digital Twin | config/README.md | Revision 1.0*
