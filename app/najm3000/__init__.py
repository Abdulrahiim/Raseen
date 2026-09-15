"""
NAJM-3000 Digital Twin
======================

Python/pvlib Proof of Concept for the NAJM-3000 3,000 MWac Utility-Scale
Solar PV Project.

Status
------
- Project: Under construction and pre-operational
- SCADA: INACTIVE — not connected
- Model calibration: NOT PERFORMED
- Model validation: NOT PERFORMED
- Operational data: DOES NOT EXIST

Warning
-------
This package is a pre-operational engineering tool. Results produced with
synthetic weather inputs are for software verification only and must be
clearly labeled:

    SYNTHETIC DEMONSTRATION — NOT PRODUCTION VALIDATION

No output of this package represents actual or predicted NAJM-3000 production
until commissioning validation is completed with measured data.

Confidentiality
---------------
This package and all associated configuration are proprietary and restricted.
See CONFIDENTIALITY.md for the full data-handling policy.
"""

__version__ = "0.1.0.dev0"
__project__ = "NAJM-3000"
__status__ = "pre-operational"
__calibration_status__ = "not-calibrated"
__validation_status__ = "not-validated"

SYNTHETIC_DISCLAIMER = "SYNTHETIC DEMONSTRATION — NOT PRODUCTION VALIDATION"
#: Label for publicly sourced (satellite/reanalysis) weather. Such data is real
#: but is not measured on the NAJM-3000 site and cannot validate the model.
PUBLIC_DATA_DISCLAIMER = (
    "PROVISIONAL PUBLIC DATA — NOT SITE-MEASURED, NOT VALIDATED"
)
PHYSICS_BASELINE_LABEL = "PHYSICS BASELINE — NOT AN OPERATIONAL FORECAST"
PROVISIONAL_SCALING_LABEL = "PROVISIONAL SCALING — NOT PRODUCTION VALIDATION"
