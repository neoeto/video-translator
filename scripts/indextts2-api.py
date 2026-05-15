#!/usr/bin/env python3
"""
IndexTTS-2 FastAPI Server for VidiTranslate

Usage:
  1. Copy this file to your IndexTTS-2 directory
  2. Install FastAPI:  uv add fastapi uvicorn python-multipart
  3. Run:  uv run python api.py
     Or:  uv run uvicorn api:app --host 0.0.0.0 --port 8080

API:
  POST /tts
    JSON body: { "text": "...", "reference_audio": "/path/to/ref.wav" }
    Response:  audio/wav

  POST /tts (multipart form)
    Form fields: text, reference_audio (file upload)
    Response:  audio/wav

  GET /health
    Response:  { "status": "ok", "model": "IndexTTS-2" }
"""

import argparse
import io
import os
import tempfile
import uuid

import soundfile as sf
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import Response

# ── Model Loading ──────────────────────────────────────────────────

DEFAULT_CFG = "checkpoints/config.yaml"
DEFAULT_MODEL_DIR = "checkpoints"
DEFAULT_REFERENCE = "examples/voice_01.wav"

app = FastAPI(title="IndexTTS-2 API", version="1.0.0")
tts_engine = None  # lazy init


def get_engine():
    global tts_engine
    if tts_engine is None:
        from indextts.infer_v2 import IndexTTS2

        cfg = os.environ.get("INDEXTTS_CFG", DEFAULT_CFG)
        model_dir = os.environ.get("INDEXTTS_MODEL_DIR", DEFAULT_MODEL_DIR)
        use_fp16 = os.environ.get("INDEXTTS_FP16", "0") == "1"
        use_deepspeed = os.environ.get("INDEXTTS_DEEPSPEED", "0") == "1"

        print(f"Loading IndexTTS-2 model from {model_dir} (fp16={use_fp16}, deepspeed={use_deepspeed})...")
        tts_engine = IndexTTS2(
            cfg_path=cfg,
            model_dir=model_dir,
            use_fp16=use_fp16,
            use_cuda_kernel=False,
            use_deepspeed=use_deepspeed,
        )
        print("IndexTTS-2 model loaded!")
    return tts_engine


# ── Routes ─────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok", "model": "IndexTTS-2"}


from pydantic import BaseModel
from typing import Optional


class TTSRequest(BaseModel):
    text: str
    reference_audio: Optional[str] = None


@app.post("/tts")
async def tts_json(req: TTSRequest):
    """
    JSON API — compatible with VidiTranslate.
    Body: { "text": "...", "reference_audio": "/path/to/ref.wav" }
    """
    engine = get_engine()
    ref = req.reference_audio or os.environ.get("INDEXTTS_DEFAULT_REF", DEFAULT_REFERENCE)

    output_path = os.path.join(tempfile.gettempdir(), f"indextts_{uuid.uuid4().hex}.wav")
    try:
        engine.infer(spk_audio_prompt=ref, text=req.text, output_path=output_path, verbose=False)

        with open(output_path, "rb") as f:
            wav_bytes = f.read()

        return Response(content=wav_bytes, media_type="audio/wav")
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)


@app.post("/tts/upload")
async def tts_upload(
    text: str = Form(...),
    reference_audio: UploadFile = File(None),
):
    """
    Multipart form API — upload reference audio file directly.
    """
    engine = get_engine()

    ref_path = None
    try:
        if reference_audio and reference_audio.filename:
            suffix = os.path.splitext(reference_audio.filename)[1] or ".wav"
            ref_fd, ref_path = tempfile.mkstemp(suffix=suffix)
            os.close(ref_fd)
            content = await reference_audio.read()
            with open(ref_path, "wb") as f:
                f.write(content)
        else:
            ref_path = os.environ.get("INDEXTTS_DEFAULT_REF", DEFAULT_REFERENCE)

        output_path = os.path.join(tempfile.gettempdir(), f"indextts_{uuid.uuid4().hex}.wav")
        engine.infer(spk_audio_prompt=ref_path, text=text, output_path=output_path, verbose=False)

        with open(output_path, "rb") as f:
            wav_bytes = f.read()

        return Response(content=wav_bytes, media_type="audio/wav")
    finally:
        if ref_path and reference_audio and reference_audio.filename and os.path.exists(ref_path):
            os.remove(ref_path)
        if "output_path" in locals() and os.path.exists(output_path):
            os.remove(output_path)


# ── Main ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IndexTTS-2 FastAPI Server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Bind port (default: 8080)")
    parser.add_argument("--fp16", action="store_true", help="Use FP16 inference")
    parser.add_argument("--deepspeed", action="store_true", help="Use DeepSpeed")
    parser.add_argument("--ref", default=None, help="Default reference audio path")
    args = parser.parse_args()

    if args.fp16:
        os.environ["INDEXTTS_FP16"] = "1"
    if args.deepspeed:
        os.environ["INDEXTTS_DEEPSPEED"] = "1"
    if args.ref:
        os.environ["INDEXTTS_DEFAULT_REF"] = args.ref

    # Pre-load model
    get_engine()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
