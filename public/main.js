const runBtn = document.getElementById("run-btn");
const statusText = document.getElementById("status-text");
const progressBar = document.getElementById("progress-bar");
const outputBox = document.getElementById("output-box");

const controlsGrid = document.getElementById("controls-grid");
const noMediaText = document.getElementById("no-media-text");
const uploadLabel = document.getElementById("upload-label");
const imageUpload = document.getElementById("image-upload");
const audioInputMethods = document.getElementById("audio-input-methods");
const audioUpload = document.getElementById("audio-upload");
const promptInput = document.getElementById("prompt-input");

const imagePreview = document.getElementById("image-preview");
const imageCanvas = document.getElementById("image-canvas");
const audioPreview = document.getElementById("audio-preview");

const tabBtns = document.querySelectorAll('.tab-btn');

let currentMode = "image";
let currentImageBase64 = null;
let currentAudioBase64 = null;
let isGenerating = false;

// --- AUDIO RECORDER GLOBALS ---
const recordBtn = document.getElementById("record-btn");
const recordStatus = document.getElementById("record-status");
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.innerText = msg;
  toast.classList.add("show");
  setTimeout(() => { toast.classList.remove("show"); }, 4000);
}

// --- SERVER STATUS ---
function updateUI(data) {
  if (isGenerating) return; 

  if (data.state === "initializing" || data.state === "loading") {
    runBtn.disabled = true;
    runBtn.innerText = "Loading Model...";
    progressBar.style.display = "block";
    progressBar.removeAttribute("value"); 
    statusText.innerText = `Status: ${data.message}`;
  } 
  else if (data.state === "downloading") {
    runBtn.disabled = true;
    runBtn.innerText = "Downloading Model...";
    progressBar.style.display = "block";
    progressBar.value = data.progress; 
    statusText.innerText = `Status: Downloading ${data.file} (${data.progress.toFixed(2)}%)`;
  } 
  else if (data.state === "ready") {
    if (runBtn.disabled) showToast("Server is ready!"); 
    runBtn.disabled = false;
    runBtn.innerText = "Run Inference";
    progressBar.style.display = "none";
    statusText.innerText = "Status: Ready!";
  }
}

async function fetchInitialStatus() {
  try {
    const res = await fetch('/api/status-check');
    const data = await res.json();
    updateUI(data);
  } catch (error) {
    console.error("Failed to fetch status:", error);
  }
}
fetchInitialStatus();

const eventSource = new EventSource('/api/status');
eventSource.onmessage = (event) => {
  updateUI(JSON.parse(event.data));
};

// --- TAB SWITCHING LOGIC ---
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    currentMode = btn.dataset.type;

    if (currentMode === "image") {
      controlsGrid.classList.remove('text-mode');
      promptInput.value = "Detect [object1], [object2].";
      uploadLabel.innerText = "Upload Image:";
      imageUpload.style.display = "block";
      audioInputMethods.style.display = "none";
      audioPreview.style.display = "none";
      imageCanvas.style.display = "none";
      
      if (currentImageBase64) {
        imagePreview.style.display = "block";
        noMediaText.style.display = "none";
      } else {
        imagePreview.style.display = "none";
        noMediaText.style.display = "block";
      }
    } 
    else if (currentMode === "audio") {
      controlsGrid.classList.remove('text-mode');
      promptInput.value = "Transcribe this audio verbatim.";
      uploadLabel.innerText = "Upload or Record Audio:";
      audioInputMethods.style.display = "block";
      imageUpload.style.display = "none";
      imagePreview.style.display = "none";
      imageCanvas.style.display = "none";
      
      if (currentAudioBase64) {
        audioPreview.style.display = "block";
        noMediaText.style.display = "none";
      } else {
        audioPreview.style.display = "none";
        noMediaText.style.display = "block";
      }
    } 
    else if (currentMode === "text") {
      controlsGrid.classList.add('text-mode');
      promptInput.value = "Explain quantum computing in simple terms.";
    }
  });
});

// --- MEDIA HANDLING ---
async function resizeImage(file, maxWidth = 800, maxHeight = 800) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

imageUpload.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (file) {
    currentImageBase64 = await resizeImage(file);
    imagePreview.src = currentImageBase64;
    imagePreview.style.display = "block";
    imageCanvas.style.display = "none";
    noMediaText.style.display = "none";
  }
});

audioUpload.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (file) {
    currentAudioBase64 = await fileToBase64(file);
    audioPreview.src = currentAudioBase64;
    audioPreview.style.display = "block";
    noMediaText.style.display = "none";
  }
});

// --- AUDIO RECORDING TO WAV LOGIC ---
recordBtn.addEventListener("click", async () => {
  if (isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.innerText = "🎤 Record Speech";
    recordBtn.classList.remove('recording');
    recordStatus.innerText = "Processing audio...";
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.start();
      isRecording = true;
      recordBtn.innerText = "⏹ Stop Recording";
      recordBtn.classList.add('recording');
      recordStatus.innerText = "Recording... Speak now.";
      audioChunks = [];

      mediaRecorder.addEventListener("dataavailable", event => {
        audioChunks.push(event.data);
      });

      mediaRecorder.addEventListener("stop", async () => {
        // Stop all mic tracks instantly to turn off the red mic icon in browser
        stream.getTracks().forEach(track => track.stop());

        const audioBlob = new Blob(audioChunks);
        const arrayBuffer = await audioBlob.arrayBuffer();
        
        // Decode recorded webm/ogg and encode perfectly to WAV using AudioContext
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const wavBlob = audioBufferToWav(audioBuffer);
        
        currentAudioBase64 = await fileToBase64(wavBlob);
        
        audioPreview.src = currentAudioBase64;
        audioPreview.style.display = "block";
        noMediaText.style.display = "none";
        recordStatus.innerText = "Audio ready for inference!";
      });
    } catch (err) {
      alert("Microphone access denied or not available.");
    }
  }
});

// WAV Encoder implementation
function audioBufferToWav(buffer) {
  let numOfChan = buffer.numberOfChannels,
      length = buffer.length * numOfChan * 2 + 44,
      bufferArray = new ArrayBuffer(length),
      view = new DataView(bufferArray),
      channels = [], i, sample, offset = 0, pos = 0;

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); // "RIFF", "WAVE"
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan); // "fmt "
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16);
  setUint32(0x61746164); setUint32(length - pos - 4); // "data"

  for (i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(offset, sample, true); offset += 2;
    }
    pos++;
  }
  return new Blob([bufferArray], { type: 'audio/wav' });

  function setUint16(data) { view.setUint16(offset, data, true); offset += 2; }
  function setUint32(data) { view.setUint32(offset, data, true); offset += 4; }
}

// --- OBJECT DETECTION RENDERER ---
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const color = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - color.length) + color;
}

function drawBoundingBoxes(boxes) {
  const img = new Image();
  img.onload = () => {
    imageCanvas.width = img.width;
    imageCanvas.height = img.height;
    const ctx = imageCanvas.getContext("2d");
    
    // Draw original image
    ctx.drawImage(img, 0, 0, img.width, img.height);

    boxes.forEach(box => {
      // Gamma4 / PaliGemma standard coordinates: [y1, x1, y2, x2]
      const [y1, x1, y2, x2] = box.box_2d;
      const label = box.label;
      const color = stringToColor(label);

      // Normalize by dividing by 1000 and multiplying by native dims
      const px1 = (x1 / 1000) * img.width;
      const py1 = (y1 / 1000) * img.height;
      const px2 = (x2 / 1000) * img.width;
      const py2 = (y2 / 1000) * img.height;

      // Draw Box
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, img.width / 250); 
      ctx.strokeRect(px1, py1, px2 - px1, py2 - py1);

      // Draw Label Background
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.max(16, img.width / 50)}px Arial`;
      const textWidth = ctx.measureText(label).width;
      const textHeight = parseInt(ctx.font, 10);
      
      ctx.fillRect(px1, py1 - textHeight - 8, textWidth + 12, textHeight + 8);

      // Draw Label Text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, px1 + 6, py1 - 6);
    });

    // Hide original image, show beautifully annotated canvas
    imagePreview.style.display = "none";
    imageCanvas.style.display = "block";
  };
  img.src = currentImageBase64;
}

// --- TRIGGER INFERENCE ---
runBtn.addEventListener("click", async () => {
  const prompt = promptInput.value;

  if (currentMode === "image" && !currentImageBase64) { alert("Please upload an image!"); return; }
  if (currentMode === "audio" && !currentAudioBase64) { alert("Please upload or record an audio file!"); return; }

  isGenerating = true;
  runBtn.disabled = true;
  outputBox.innerHTML = "";
  let aggregatedText = ""; // Collect text strictly for Object Detection Parsing
  
  // Reset preview mode back to raw image when re-running
  if (currentMode === "image" && currentImageBase64) {
    imageCanvas.style.display = "none";
    imagePreview.style.display = "block";
  }

  statusText.innerText = "Status: Processing...";

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputType: currentMode,
        prompt: prompt,
        imageBase64: currentMode === "image" ? currentImageBase64 : null,
        audioBase64: currentMode === "audio" ? currentAudioBase64 : null
      })
    });

    if (!response.ok) throw new Error("Server Error");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      outputBox.innerHTML += chunk;
      aggregatedText += chunk;
    }

    // --- OBJECT DETECTION PARSER ---
    if (currentMode === "image" && prompt.toLowerCase().includes("detect")) {
      try {
        // Extract array `[...]` to bypass extra conversational padding from AI
        const match = aggregatedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (match) {
          const parsedJSON = JSON.parse(match[0]);
          if (Array.isArray(parsedJSON) && parsedJSON.length > 0 && parsedJSON[0].box_2d) {
             drawBoundingBoxes(parsedJSON);
          }
        }
      } catch (err) {
        console.error("Failed to parse JSON for bounding boxes.", err);
      }
    }

    statusText.innerText = "Status: Inference Complete!";
  } catch (error) {
    console.error("Error:", error);
    statusText.innerText = `Error: ${error.message}`;
  } finally {
    isGenerating = false;
    runBtn.disabled = false;
  }
});