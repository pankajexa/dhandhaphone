"""
DhandhaPhone Cloud LLM Router
Primary: Anthropic Claude for agentic actions.
Optional fallback: Gemini Flash (cheap), DeepSeek V3 (medium).
Reads API keys from ../.env or environment variables.
"""
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from dotenv import load_dotenv
from pathlib import Path
import httpx
import os
import time

# Load .env from project root (one level up from server/)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="DhandhaPhone LLM Router")

# --- Config ---
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY")


# --- Startup validation ---
@app.on_event("startup")
async def validate_keys():
    if not ANTHROPIC_KEY:
        print("⚠️  ANTHROPIC_API_KEY not set. Add it to .env file.")
        print("   Get key: https://console.anthropic.com/settings/keys")
    else:
        print("✅ ANTHROPIC_API_KEY loaded")

    if GEMINI_KEY:
        print("✅ GEMINI_API_KEY loaded (optional fallback)")
    if DEEPSEEK_KEY:
        print("✅ DEEPSEEK_API_KEY loaded (optional fallback)")


# --- Models ---
class ChatRequest(BaseModel):
    messages: list[dict]
    tier: str = "auto"  # auto, simple, medium, complex
    max_tokens: int = 1000


class ChatResponse(BaseModel):
    content: str
    model_used: str
    tokens_used: int
    cost_inr: float


# --- Device Auth (basic for MVP) ---
def verify_device(device_id: str, api_key: str) -> bool:
    # MVP: accept all. Production: validate against DB
    return True


# --- LLM Providers ---
async def call_claude(messages: list[dict], max_tokens: int) -> tuple[str, float]:
    """Primary: Anthropic Claude — best reasoning for agentic actions"""
    if not ANTHROPIC_KEY:
        raise ValueError("ANTHROPIC_API_KEY not configured")

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": max_tokens,
                "messages": messages,
            },
        )
        data = resp.json()
        text = data["content"][0]["text"]
        input_tokens = data.get("usage", {}).get("input_tokens", 0)
        output_tokens = data.get("usage", {}).get("output_tokens", 0)
        cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 85
        return text, cost


async def call_gemini(messages: list[dict], max_tokens: int) -> tuple[str, float]:
    """Fallback: Gemini Flash — cheapest, fastest"""
    if not GEMINI_KEY:
        raise ValueError("GEMINI_API_KEY not configured")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}",
            json={
                "contents": [
                    {"parts": [{"text": m["content"]}]}
                    for m in messages
                    if m["role"] == "user"
                ],
                "generationConfig": {"maxOutputTokens": max_tokens},
            },
        )
        data = resp.json()
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        return text, 0.1


async def call_deepseek(messages: list[dict], max_tokens: int) -> tuple[str, float]:
    """Fallback: DeepSeek V3 — good reasoning, moderate cost"""
    if not DEEPSEEK_KEY:
        raise ValueError("DEEPSEEK_API_KEY not configured")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {DEEPSEEK_KEY}"},
            json={
                "model": "deepseek-chat",
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        tokens = data.get("usage", {}).get("total_tokens", 0)
        return text, tokens * 0.0001


# --- Routing ---
@app.post("/v1/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    x_device_id: str = Header(...),
    x_api_key: str = Header(...),
):
    if not verify_device(x_device_id, x_api_key):
        raise HTTPException(401, "Invalid device credentials")

    # Primary: always try Anthropic first
    try:
        text, cost = await call_claude(req.messages, req.max_tokens)
        return ChatResponse(
            content=text,
            model_used="claude-sonnet",
            tokens_used=0,
            cost_inr=round(cost, 2),
        )
    except Exception as e:
        print(f"Claude failed: {e}")

    # Fallback 1: Gemini Flash
    if GEMINI_KEY:
        try:
            text, cost = await call_gemini(req.messages, req.max_tokens)
            return ChatResponse(
                content=text,
                model_used="gemini-flash-fallback",
                tokens_used=0,
                cost_inr=round(cost, 2),
            )
        except Exception as e:
            print(f"Gemini fallback failed: {e}")

    # Fallback 2: DeepSeek
    if DEEPSEEK_KEY:
        try:
            text, cost = await call_deepseek(req.messages, req.max_tokens)
            return ChatResponse(
                content=text,
                model_used="deepseek-fallback",
                tokens_used=0,
                cost_inr=round(cost, 2),
            )
        except Exception as e:
            print(f"DeepSeek fallback failed: {e}")

    raise HTTPException(500, "All LLM providers failed. Check API keys in .env file.")


@app.get("/health")
def health():
    keys = {
        "anthropic": bool(ANTHROPIC_KEY),
        "gemini": bool(GEMINI_KEY),
        "deepseek": bool(DEEPSEEK_KEY),
    }
    return {"status": "ok", "timestamp": time.time(), "keys_configured": keys}
