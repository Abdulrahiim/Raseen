"""Raseen (رَصين) — Block Gradient Control for gigawatt solar. Prototype dashboard.

Nothing served by this package is measured, calibrated or validated data.
"""

__version__ = "0.1.0"

#: Carried on every API response so no page can render a value without its provenance.
CLASSIFICATION = "SIMULATION (RASEEN PROTOTYPE)"

DISCLAIMER = (
    "SIMULATED — NOT MEASURED DATA. Plant geometry is as-designed, not as-built. "
    "The irradiance driver is representative. The controller is real code. "
    "Telemetry, forecast, PPC and TSP are simulated. NOT CALIBRATED — NOT VALIDATED."
)

#: The reference plant inside the twin.
PLANT_NAME = "Humaij"
PLANT_MW = 3000.0
#: Design basis says 365 MV power stations; the CAD/KML geometry carries 363 (GAP-019 unresolved).
MVPS_COUNT_DESIGN = 365
