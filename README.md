# Gemma 4 on Browser

On-device multimodal inference with Gemma 4-E2B-it running entirely on a local Node.js server. Supports image understanding, audio transcription, and text generation, all streamed live to the browser.

## How it works

The server loads the ONNX-quantized Gemma 4-E2B-it model (q4f16) using HuggingFace Transformers.js. When you submit a request, the server builds a multimodal prompt, runs generation, and streams tokens back to the browser as plain text chunks using chunked transfer encoding. The browser renders each chunk as it arrives.

**Image mode:** Upload any image. The server writes it to a temp file, loads it via `load_image()`, and passes it as a vision token to the model. Great for description, captioning, or object detection (paste a detection prompt and bounding boxes are drawn on the canvas automatically).

**Audio mode:** Upload a WAV file or record directly from the microphone. Recorded audio is captured via the MediaRecorder API, decoded with AudioContext, and re-encoded as 16-bit WAV at 16kHz (the sample rate Gemma expects). On the server side, the wavefile package handles stereo-to-mono conversion and sample rate resampling before the audio tensor is built.

**Text mode:** Plain prompt input, no media required.

## Model loading

On first run, model weights are downloaded from Hugging Face Hub and cached locally. A Server-Sent Events (SSE) endpoint (`/api/status`) pushes download progress and loading state to the browser in real time, so you can see the progress bar advance while the model loads.

## Project structure

```
Gemma-4-on-Browser/
├── server.mjs           # Express server: model loading, SSE, inference endpoint
├── public/
│   ├── index.html       # Three-tab UI (Image, Audio, Text)
│   ├── main.js          # Client logic: SSE, tab switching, streaming, bounding boxes
│   └── style.css        # All UI styles
├── package.json
└── README.md
```

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | SSE stream for model load progress |
| GET | `/api/status-check` | One-shot current status (JSON) |
| POST | `/api/generate` | Run inference (image/audio/text) |

## Steps to run

1. Clone the repository on your local machine.
2. Navigate to the `Gemma-4-on-Browser` directory.
3. Run `npm install` to install packages.
4. Run `node server.mjs` to start the server.
5. Open `localhost:3000` in your browser.

> [!NOTE]
> The model weights (~4GB) are downloaded and cached on first run. This can take several minutes depending on your connection. Subsequent runs load from cache and are much faster.

## Tips

- Use **Ctrl+Enter** (or Cmd+Enter on Mac) to submit without clicking the button.
- For object detection, include the word "detect" in your prompt. The app will parse the model's JSON bounding box output and draw labeled boxes directly on the image.
- The Copy button appears after each inference so you can grab the output text easily.
- Audio recording captures from your default microphone. Longer recordings work fine; the model handles full-sentence audio without truncation.
