const AudioContext = window.AudioContext || window.webkitAudioContext;

const audioInputSelector = document.getElementById('audio-input-select');
const currentEffectText = document.getElementById('current-effect-text');

const volumeRadio = document.getElementById('volume');
const wahRadio = document.getElementById('wah');
const pitchRadio = document.getElementById('pitch');

const loadingSpinner = document.getElementById('loading-spinner');

// Try to create the AudioContext with as low latency as possible.
// Unfortunately, it's still quite high latency on Windows regardless.
const audioContext = new AudioContext({ latencyHint: 0 });

// Node for controlling output volume.
const gainNode = audioContext.createGain();
gainNode.gain.value = 1;

// Wah-wah effect node.
const wahWahNode = createWahWah();

// These numbers are based on the numbers for my mouth.
let maxMouthHeight = 60;
let minMouthHeight = 15;

// Node for pitch shifting. Set up in setupAudioContext.
let phaseVocoderNode;

// How much the pitch was shifed by in the last mouth update.
let lastPitchShiftFactor;

// This merges the audio channels so that it's played back on both left and 
// right sides if it's a mono one sided output like with my 
// Scarlette Focusrite 2i2.
const splitterNode = audioContext.createChannelSplitter(1);

// This node makes the guitar sound a bit more like it's playing through a 
// real amp.
const convolverNode = audioContext.createConvolver();

const makeupGain = audioContext.createGain();
makeupGain.gain.value = 5;

const overdrive = createOverdrive();

// Whether each effect is active or not.
const effectStatus = {
  'volume': true,
  'wah': false,
  'pitch': false,
};

// An array of Web Audio Nodes to connect.
let effects = [];

volumeRadio.addEventListener('change', effectChanged);
wahRadio.addEventListener('change', effectChanged);
pitchRadio.addEventListener('change', effectChanged);

function effectChanged(event) {
  const radio = event.target;
  effectStatus[radio.id] = radio.checked;

  // Reset the other effects.
  for (const effect in effectStatus) {
    if (effect !== radio.id) {
      effectStatus[effect] = false;
    }
  }

  setupAudioContext();
  let effectText;
  switch (radio.id) {
    case 'volume':
      effectText = 'Volume';
      break;
    case 'wah':
      effectText = 'Wah-wah';
      break;
    case 'pitch':
      effectText = 'Pitch Shift';
      break;
    default:
      effectText = 'None';
  }
  currentEffectText.innerHTML = effectText;
}
// When the audio input changes, reset the Audio Context.
audioInputSelector.addEventListener('change', setupAudioContext);

document.body.addEventListener('click', resumeAudioContext);

// The mic input device. Set in setInputDevices().
let guitarAudio;

let initialAudioNodeSetupCompleted = false;

async function initialAudioNodeSetup() {
  // Creates a node for pitch shifting.
  await audioContext.audioWorklet.addModule('/libraries/phase-vocoder.min.js');
  phaseVocoderNode =
    new AudioWorkletNode(audioContext, 'phase-vocoder-processor');

  convolverNode.buffer =
    await getImpulseBuffer(audioContext, '/assets/ampIR.wav');

  initialAudioNodeSetupCompleted = true;
}

async function startup() {
  // Set the input device before setting up the audio context
  // so that proper sound/echo cancelling can be applied depending
  // on the device type.
  await setInputDevices();
  await initialAudioNodeSetup();
  setupAudioContext();
}

startup();

/** 
 * The audio context can only be started if the user interacts with the page.
 * Sometimes it can get into a suspended state and need to be resumed on 
 * user input, this just helps ensure it doesn't stay suspended.
 */
function resumeAudioContext() {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

const getImpulseBuffer = async (audioCtx, impulseUrl) => {
  try {
    const response = await fetch(impulseUrl);
    const arrayBuffer = await response.arrayBuffer();
    return audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    return console.error(e);
  }
}

/** Connect all active effects together. */
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
    // Connect the last node to the destination to allow for playback.
    if (i === effects.length - 1) {
      effects[i].connect(audioContext.destination);
    }
  }
}

/** Disconnect all active effects from the effects chain. */
function disconnectEffects(guitarAudio) {
  if (guitarAudio) {
    guitarAudio.disconnect();
  }
  effects.forEach((effect) => {
    effect.disconnect();
  });
  effects = [];
}

/** 
 * Set up the audio context by connecting all active effects and connecting the 
 * mic input to the output.
 */
async function setupAudioContext() {
  // Disconnect any existing nodes to make sure all state is cleared out when
  // connecting them again.
  if (guitarAudio) {
    disconnectEffects(guitarAudio);
  }
  const mic = await getMic();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  guitarAudio = audioContext.createMediaStreamSource(mic);
  guitarAudio.bufferSize = 128;

  // If the initial audio node setup hasn't happened because the Audio Context
  // was not yet connected, do it now.
  if (!initialAudioNodeSetupCompleted) {
    await initialAudioNodeSetup();
  }
  // Reset any pitch change.
  const pitchFactorParam = phaseVocoderNode.parameters.get('pitchFactor');
  pitchFactorParam.value = 1;

  // Reset the gain node value to default.
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

  // Connect all effects in the effects array.
  connectEffects(guitarAudio);
}

/** Add options for audio input devices to the audio input selector.  */
async function setInputDevices() {
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const devices = await navigator.mediaDevices.enumerateDevices();
  devices.forEach((device) => {
    if (device.kind === 'audioinput') {
      const option = document.createElement('option');
      option.text = device.label;
      option.value = device.deviceId;
      audioInputSelector.add(option);
    }
  });
}

async function getMic() {
  // Apply noise cancelling if the current device appears to be a mic instead
  // of an audio interface. Otherwise there can be harsh feedback.
  const isMicrophone = audioInputSelector.options[
    audioInputSelector.selectedIndex]?.text.toLowerCase().includes('mic');
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

function createOverdrive() {
  const overdrive = audioContext.createWaveShaper();
  overdrive.curve = makeDistortionCurve(150);
  overdrive.oversample = '4x';
  return overdrive;
}

// Copied from: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createWaveShaper#examples.
function makeDistortionCurve(amount) {
  const k = typeof amount === 'number' ? amount : 50;
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
  filter.Q.value = 1;
  filter.frequency.value = 1000;

  return filter;
}

/** 
 * The drawing code below is based on the ml5.js FaceApi Video Landmarks example:
 * https://github.com/ml5js/ml5-library/tree/main/examples/javascript/FaceApi/FaceApi_Video_Landmarks/
 */
let faceapi;
let video;
const width = 720;
const height = 540;
let canvas, ctx;

const detectionOptions = {
  withLandmarks: true,
  withDescriptors: false,
};

async function startFaceTracking() {
  video = await getVideo();

  canvas = createCanvas(width, height);
  ctx = canvas.getContext('2d');

  faceapi = ml5.faceApi(video, detectionOptions, modelReady);
}

window.addEventListener('DOMContentLoaded', function () {
  startFaceTracking();
});

function modelReady() {
  loadingSpinner.classList.add('hidden');
  faceapi.detectSingle(gotResults);
}

async function getVideo() {
  // Grab elements, create settings, etc.
  const videoElement = document.createElement('video');
  videoElement.setAttribute('style', 'display: none;');
  videoElement.width = width;
  videoElement.height = height;
  document.body.appendChild(videoElement);

  // Create a webcam capture.
  const capture =
    await navigator.mediaDevices.getUserMedia({ video: { width, height } });
  videoElement.srcObject = capture;
  videoElement.play();

  return videoElement;
}

function createCanvas(w, h) {
  const canvas = document.getElementById('main-canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function gotResults(err, result) {
  if (err) {
    console.error(err);
    // There are sometimes randomly errors with the face tracking API that 
    // can only be fixed by reloading the page. Still need to investigate why
    // this happens, but for now just show and alert and then reload the page.
    alert("There was an error loading face tracking, please press ok to reload the page.")
    location.reload();
    return;
  }

  // We only care about the first face detected.
  const detection = result[0];

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(video, 0, 0, width, height);

  if (detection) {
    drawBox(detection);
    drawLandmarks(detection);
    modifyActiveEffects(detection);
  }
  faceapi.detect(gotResults);
}

/** Draws a box around the detected face. */
function drawBox(detection) {
  // Only draw a box around the 
  const alignedRect = detection.alignedRect;
  const x = alignedRect._box._x;
  const y = alignedRect._box._y;
  const boxWidth = alignedRect._box._width;
  const boxHeight = alignedRect._box._height;

  ctx.beginPath();
  ctx.rect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = '#13fe32';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.closePath();
}

/** Draws facial features on the detected face. */
function drawLandmarks(detection) {
  const mouth = detection.parts.mouth;
  const nose = detection.parts.nose;
  const leftEye = detection.parts.leftEye;
  const rightEye = detection.parts.rightEye;
  const rightEyeBrow = detection.parts.rightEyeBrow;
  const leftEyeBrow = detection.parts.leftEyeBrow;

  drawPart(mouth, true);
  drawPart(nose, false);
  drawPart(leftEye, true);
  drawPart(leftEyeBrow, false);
  drawPart(rightEye, true);
  drawPart(rightEyeBrow, false);
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

/** Scales active effects based on the detected mouth height. */
function modifyActiveEffects(detection) {
  const mouth = detection.parts.mouth;

  if (!mouth) {
    return;
  }

  // My mouth height range is approximately 15 to 60.
  const mouthHeight = findHeight(mouth);

  maxMouthHeight = Math.max(maxMouthHeight, mouthHeight);
  minMouthHeight = Math.min(minMouthHeight, mouthHeight);

  // Normalize the scale to be between 0 and 1.
  const scale =
    (mouthHeight - minMouthHeight) / (maxMouthHeight - minMouthHeight);
  // Change wah frequency based on mouth height.
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
    // Set the min pitch factor to .5 because it gets pretty distorted lower.
    const pitchFactor = Math.max(.5, Math.round((scale * 3) * 10) / 10);

    // Only shift the pitch if it has changed a decent amount since the last
    // update to avoid constantly changing.
    if (!lastPitchShiftFactor ||
      Math.abs(lastPitchShiftFactor - pitchFactor) >= .15) {
      pitchFactorParam.setValueAtTime(pitchFactor, audioContext.currentTime);
    }
    lastPitchShiftFactor = pitchFactor;
  }
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

function setWahWahFreq(value) {
  const maxFreq = 2200;
  const newFreq = maxFreq * value;
  wahWahNode.frequency.setValueAtTime(newFreq, audioContext.currentTime);
}
