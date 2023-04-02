const AudioContext = window.AudioContext || window.webkitAudioContext;

const audioInputSelector = document.getElementById('audio-input-select');
const irButton = document.querySelector("#ir-button");
const currentEffectText = document.querySelector("#current-effect-text");

const volumeCheckbox = document.querySelector('#volume');
const wahCheckbox = document.querySelector('#wah');
const pitchCheckbox = document.querySelector('#pitch');

const loadingSpinner = document.getElementById('loading-spinner');
console.log(loadingSpinner);

const audioContext = new AudioContext({ latencyHint: 0 });
const gainNode = audioContext.createGain();
gainNode.gain.value = 1;

const wahWahNode = createWahWah();

let maxMouthHeight = 60;
let minMouthHeight = 15;

let irEnabled = true;

let phaseVocoderNode;
let lastPitchShiftFactor;

const effectStatus = {
  'volume': true,
  'wah': false,
  'pitch': false,
};

let effects = [];

irButton.addEventListener('click', () => {
  const buttonText = irEnabled ? 'Enable IR' : 'Disable IR';
  irEnabled = !irEnabled;
  irButton.innerHTML = buttonText;
  setupContext();
});

volumeCheckbox.addEventListener('change', effectChanged);
wahCheckbox.addEventListener('change', effectChanged);
pitchCheckbox.addEventListener('change', effectChanged);

function effectChanged(event) {
  const checkbox = event.target;
  effectStatus[checkbox.id] = checkbox.checked;

  // Reset the other effects.
  for (const effect in effectStatus) {
    if (effect !== checkbox.id) {
      effectStatus[effect] = false;
    }
  }

  setupContext();
  let effectText;
  switch (checkbox.id) {
    case 'volume':
      effectText = 'Volume';
      break;
    case 'wah':
      effectText = 'Wah Wah';
      break;
    case 'pitch':
      effectText = 'Pitch Shift';
      break;
    default:
      effectText = 'None';
  }
  currentEffectText.innerHTML = effectText;
}


audioInputSelector.addEventListener('change', audioInputChanged);
document.body.addEventListener('click', startAudioContext);

let guitarAudio;

async function startup() {
  // Get input devices before setting up the audio context
  // so proper sound/echo cancelling can be applied depending
  // on the device type.
  await setInputDevices();
  setupContext();
}

startup();

async function startFaceTracking() {
  // get the video
  video = await getVideo();

  canvas = createCanvas(width, height);
  ctx = canvas.getContext("2d");

  faceapi = ml5.faceApi(video, detectionOptions, modelReady);
}

// call app.map.init() once the DOM is loaded
window.addEventListener("DOMContentLoaded", function () {
  startFaceTracking();
});

function modelReady() {
  console.log("ready!");
  loadingSpinner.classList.add("hidden");
  faceapi.detectSingle(gotResults);
}

function startAudioContext() {
  if (audioContext.state === 'suspended') {
    console.log('restart');
    audioContext.resume();
  }
}

const getImpulseBuffer = (audioCtx, impulseUrl) => {
  return fetch(impulseUrl)
    .then(response => response.arrayBuffer())
    .then(arrayBuffer => audioCtx.decodeAudioData(arrayBuffer))
    .catch((e) => console.error(e));
}

function connectEffects(guitarAudio) {
  let prevNode = guitarAudio;
  if (!effects.length) {
    guitarAudio.connect(audioContext.destination);
    return;
  }
  guitarAudio.connect(effects[0]);
  prevNode = effects[0];
  for (let i = 1; i < effects.length; i++) {
    prevNode.connect(effects[i]);
    prevNode = effects[i];
    if (i === effects.length - 1) {
      effects[i].connect(audioContext.destination);
    }
  }
}

function disconnectEffects(guitarAudio) {
  if (guitarAudio) {
    guitarAudio.disconnect();
  }
  effects.forEach((effect) => {
    effect.disconnect();
  });
  effects = [];
}

/** Set up the audio context by getting the input device and connecting it to the output. */
async function setupContext() {
  if (guitarAudio) {
    disconnectEffects(guitarAudio);
  }
  const mic = await getMic();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  guitarAudio = audioContext.createMediaStreamSource(mic);
  guitarAudio.bufferSize = 128;

  // This merges the audio channels so that it's played back on
  // both left and right sides if it's a mono one sided output
  // like with my Scarlette Focusrite 2i2.
  const splitterNode = audioContext.createChannelSplitter(1);

  const convolverNode = audioContext.createConvolver();
  convolverNode.buffer = await getImpulseBuffer(audioContext, 'ir.wav');

  const makeupGain = audioContext.createGain();
  makeupGain.gain.value = 5;

  const overdrive = createOverdrive();

  await audioContext.audioWorklet.addModule('scripts/phase-vocoder.min.js');
  phaseVocoderNode = new AudioWorkletNode(audioContext, 'phase-vocoder-processor');

  const pitchFactorParam = phaseVocoderNode.parameters.get('pitchFactor');
  pitchFactorParam.value = 1;

  gainNode.gain.value = 1;

  // Add in all currently enabled effects. The order
  // in the effects list is the order in the effects chain.
  effects.push(splitterNode);

  if (effectStatus.pitch) {
    effects.push(phaseVocoderNode);
  }
  if (effectStatus.wah) {
    effects.push(wahWahNode)
  }

  effects.push(...[convolverNode, makeupGain, overdrive, gainNode]);

  connectEffects(guitarAudio);
}

/** Add options for audio input devices to the audio input selector.  */
async function setInputDevices() {
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const devices = await navigator.mediaDevices.enumerateDevices();
  devices.forEach((device) => {
    if (device.kind === 'audioinput') {
      console.log(device);
      const option = document.createElement('option');
      option.text = device.label;
      option.value = device.deviceId;
      audioInputSelector.add(option);
    }
  });
}

async function getMic() {
  // Apply noise cancelling if the current device appears to be a mic instead
  // of an audio interface. Otherwise there is annoying feedback.
  const isMicrophone =
    audioInputSelector.options[audioInputSelector.selectedIndex]?.text.toLowerCase().includes('mic');
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: isMicrophone,
      autoGainControl: isMicrophone,
      noiseSuppression: isMicrophone,
      latency: 0,
      deviceId: audioInputSelector.value,
    }
  });
}

function audioInputChanged() {
  console.log(audioInputSelector.value);
  setupContext();
}

function createOverdrive() {
  const overdrive = audioContext.createWaveShaper();
  overdrive.curve = makeDistortionCurve(200);
  overdrive.oversample = '4x';
  return overdrive;
}

// Copied from: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createWaveShaper#examples.
function makeDistortionCurve(amount) {
  const k = typeof amount === "number" ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;

  for (let i = 0; i < n_samples; i++) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function createWahWah() {
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1; // quality factor of the filter
  filter.frequency.value = 1000; // center frequency of the filter

  return filter;
}

let faceapi;
let video;
let detections;
const width = 720;
const height = 540;
let canvas, ctx;

// by default all options are set to true
const detectionOptions = {
  withLandmarks: true,
  withDescriptors: false,
};

function gotResults(err, result) {
  if (err) {
    console.log(err);
    return;
  }

  detections = result;

  // Clear part of the canvas
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(video, 0, 0, width, height);

  if (detections) {
    if (detections.length > 0) {
      drawBox(detections);
      drawLandmarks(detections);
    }
  }
  faceapi.detect(gotResults);
}

function drawBox(detections) {
  for (let i = 0; i < detections.length; i += 1) {
    const alignedRect = detections[i].alignedRect;
    const x = alignedRect._box._x;
    const y = alignedRect._box._y;
    const boxWidth = alignedRect._box._width;
    const boxHeight = alignedRect._box._height;

    ctx.beginPath();
    ctx.rect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = "#13fe32";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.closePath();
  }
}

function drawLandmarks(detections) {
  for (let i = 0; i < detections.length; i += 1) {
    const mouth = detections[i].parts.mouth;
    const nose = detections[i].parts.nose;
    const leftEye = detections[i].parts.leftEye;
    const rightEye = detections[i].parts.rightEye;
    const rightEyeBrow = detections[i].parts.rightEyeBrow;
    const leftEyeBrow = detections[i].parts.leftEyeBrow;

    drawPart(mouth, true);
    drawPart(nose, false);
    drawPart(leftEye, true);
    drawPart(leftEyeBrow, false);
    drawPart(rightEye, true);
    drawPart(rightEyeBrow, false);


    // My height range is 15 to 65
    const mouthHeight = findHeight(mouth);

    maxMouthHeight = Math.max(maxMouthHeight, mouthHeight);
    minMouthHeight = Math.min(minMouthHeight, mouthHeight);

    // Normalize between 0 to 1
    const scale = (mouthHeight - minMouthHeight) / (maxMouthHeight - minMouthHeight);
    // Change either wah frequency or gain based on mouth height.
    if (effectStatus.wah) {
      setWahWahFreq(scale);
    }
    // Change volume based on mouth height.
    if (effectStatus.volume) {
      gainNode.gain.setValueAtTime(scale * 1.5, audioContext.currentTime);
    }
    // Change pitch based on mouth height.
    if (effectStatus.pitch) {
      const pitchFactorParam = phaseVocoderNode.parameters.get('pitchFactor');
      const pitchFactor = Math.max(.5, Math.round((scale * 3) * 10) / 10);

      // Only shift the pitch if it has changed a decent amount to avoid constantly changing.
      if (!lastPitchShiftFactor || Math.abs(lastPitchShiftFactor - pitchFactor) >= .15) {
        pitchFactorParam.setValueAtTime(pitchFactor, audioContext.currentTime);
      }
      lastPitchShiftFactor = pitchFactor;
    }
  }
}

function drawPart(feature, closed) {
  ctx.beginPath();
  for (let i = 0; i < feature.length; i += 1) {
    const x = feature[i]._x;
    const y = feature[i]._y;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  if (closed === true) {
    ctx.closePath();
  }
  ctx.stroke();
}

// Helper Functions
async function getVideo() {
  // Grab elements, create settings, etc.
  const videoElement = document.createElement("video");
  videoElement.setAttribute("style", "display: none;");
  videoElement.width = width;
  videoElement.height = height;
  document.body.appendChild(videoElement);

  // Create a webcam capture
  const capture = await navigator.mediaDevices.getUserMedia({ video: { width, height } });
  videoElement.srcObject = capture;
  videoElement.play();

  return videoElement;
}

function createCanvas(w, h) {
  const canvas = document.getElementById("main-canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function setWahWahFreq(value) {
  const maxFreq = 2200;
  const newFreq = maxFreq * value;
  wahWahNode.frequency.setValueAtTime(newFreq, audioContext.currentTime);
}

function findHeight(feature) {
  let minY = Number.MAX_VALUE;
  let maxY = Number.MIN_VALUE;

  for (let i = 0; i < feature.length; i += 1) {
    minY = Math.min(minY, feature[i]._y);
    maxY = Math.max(maxY, feature[i]._y);
  }
  return maxY - minY;
}
