import express from 'express';
import fs from 'fs';
import { createRequire } from 'module';
import { Buffer } from 'node:buffer';
import wavefilePkg from 'wavefile'; // <-- Import the default package first
const { WaveFile } = wavefilePkg;   // <-- Then extract WaveFile from it!

import {
  AutoProcessor,
  Gemma4ForConditionalGeneration,
  TextStreamer,
  load_image,
  env
} from "@huggingface/transformers";

const require = createRequire(import.meta.url);
const path = require('path');
global.Buffer = Buffer;

const app = express();
const port = 3000;

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' })); 

let processor;
let model;

// --- SERVER-SENT EVENTS (SSE) FOR PROGRESS BAR ---
let sseClients = [];
let currentStatus = { state: "initializing", message: "Starting server..." };

app.get('/api/status-check', (req, res) => {
  res.json(currentStatus);
});

app.get('/api/status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(currentStatus)}\n\n`);

  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

function broadcastStatus(newStatus) {
  currentStatus = { ...currentStatus, ...newStatus };
  sseClients.forEach(client => client.write(`data: ${JSON.stringify(currentStatus)}\n\n`));
}

// --- MODEL LOADING ---
async function loadModel() {
  console.log("Initializing Gemma 4-E2B-it");

  const model_id = "onnx-community/gemma-4-E2B-it-ONNX";
  
  broadcastStatus({ state: "loading", message: "Loading processor..." });
  processor = await AutoProcessor.from_pretrained(model_id);
  
  broadcastStatus({ state: "loading", message: "Reading model from cache to RAM (takes a moment)..." });
  
  model = await Gemma4ForConditionalGeneration.from_pretrained(model_id, {
    dtype: "q4f16", 
    progress_callback: (info) => {
      if (info.status === 'download') {
        console.log(`Downloading ${info.file}...`);
        broadcastStatus({ state: "downloading", file: info.file, progress: 0 });
      } else if (info.status === 'progress') {
        broadcastStatus({ state: "downloading", file: info.file, progress: info.progress });
      } else if (info.status === 'done') {
        console.log(`Finished downloading ${info.file}`);
        broadcastStatus({ state: "loading", message: `Finished downloading ${info.file}. Compiling...` });
      }
    }
  });
  
  console.log("");
  console.log(`Model loaded successfully and is ready for inference`);
  console.log(`Server listening at http://localhost:${port}`);
  console.log("");

  broadcastStatus({ state: "ready", message: "Model is ready." });
}

loadModel();

// --- INFERENCE ENDPOINT ---
app.post('/api/generate', async (req, res) => {
  const { inputType, prompt, imageBase64, audioBase64 } = req.body;

  console.log(`\n`);
  console.log(`[NEW REQUEST] Type: ${inputType.toUpperCase()}`);
  console.log(`Prompt: "${prompt}"`);

  if (!model || !processor) {
    return res.status(503).json({ error: "Model is still loading. Please wait." });
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  let tempFilePath = null;

  try {
    let image_input = undefined;
    let audio_input = undefined;
    let contentArray = [];
    
    // --- 1. Process Image ---
    if (inputType === "image" && imageBase64) {
      const buffer = Buffer.from(imageBase64.split(',')[1], 'base64');
      tempFilePath = path.join(process.cwd(), `temp_image_${Date.now()}.jpg`);
      fs.writeFileSync(tempFilePath, buffer);
      
      image_input = await load_image(tempFilePath);
      contentArray.push({ type: "image" });
      console.log(`Image processed.`);
    } 
    // --- 2. Process Audio (Using WaveFile for Node.js) ---
    else if (inputType === "audio" && audioBase64) {
      const buffer = Buffer.from(audioBase64.split(',')[1], 'base64');
      
      // Decode audio natively using wavefile package
      const wav = new WaveFile(buffer);
      wav.toBitDepth('32f'); // Pipeline expects Float32 Array
      wav.toSampleRate(16000); // Model expects 16kHz sample rate
      
      let audioData = wav.getSamples();
      
      // Handle multi-channel (Stereo to Mono)
      if (Array.isArray(audioData)) {
        if (audioData.length > 1) {
          const SCALING_FACTOR = Math.sqrt(2);
          for (let i = 0; i < audioData[0].length; ++i) {
            audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
          }
        }
        audioData = audioData[0];
      }
      
      // Cast cleanly to Float32Array for the Gemma Extractor
      audio_input = new Float32Array(audioData);
      contentArray.push({ type: "audio" });
      console.log(`Audio processed.`);
    }

    contentArray.push({ type: "text", text: prompt });

    const messages = [{ role: "user", content: contentArray }];
    const formattedPrompt = processor.apply_chat_template(messages, { 
      enable_thinking: false, 
      add_generation_prompt: true 
    });

    const inputs = await processor(formattedPrompt, image_input, audio_input, { add_special_tokens: false });

    console.log(`Output: `);
    
    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => {
        process.stdout.write(text); 
        res.write(text);            
      },
    });

    await model.generate({
      ...inputs,
      max_new_tokens: 512,
      do_sample: false,
      streamer: streamer,
    });

    console.log(`\n\nInference complete!`);
    console.log(`-----------------------------------------`);
    res.end();

  } catch (error) {
    console.error("\nInference Error:", error);
    res.write(`\n\n[Server Error: ${error.message}]`);
    res.end();
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
});

app.listen(port);