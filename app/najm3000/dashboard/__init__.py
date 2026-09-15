"""Pre-commissioning dashboard backend.

Serves simulated telemetry through the same ``HistorianAdapter`` contract the
real historian will implement, so the dashboard built on top requires no change
at commissioning.

Nothing here is live, measured, or calibrated data.
"""
