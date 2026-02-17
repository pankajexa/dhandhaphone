#!/bin/bash
# DhandhaPhone Cloud LLM Router
# API keys are loaded from ../.env automatically (via python-dotenv)
# To set up: cp .env.example .env && edit .env

cd "$(dirname "$0")"
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
