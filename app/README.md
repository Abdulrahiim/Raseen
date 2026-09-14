# Raseen dashboard (prototype)

Block Gradient Control for gigawatt solar. Everything served is simulated and labelled so.

## Run locally

    python -m venv .venv
    .venv\Scripts\python.exe -m pip install -e ".[dev]"
    .venv\Scripts\python.exe -m raseen
    # open http://127.0.0.1:8000

## Test

    .venv\Scripts\python.exe -m pytest
