A website where you can control guitar effects by moving your mouth.

How well this works varies between browsers and OS combinations. Mac OS with Chrome seems to be the best
combination in terms of latency and how the effects sound. Windows unfortunately has a lot of latency due to
how the audio driver system works. 

It will also work best if you have an audio interface and select that as the mic input. I've primarily tested with an interface (Scarlet Focusrite 2i2) so I'm not sure if it will really work without one.

This is just for fun and I haven't test it super thouroughly, so apologies if it doesn't work for your particular setup!

This project uses the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) for the effects with [ml5.js](https://github.com/ml5js/ml5-library) for face tracking.

The pitch shifting is from https://github.com/olvb/phaze.

#### Dependency licenses

ml5.js: https://ml5js.org/license  
fft.js: https://github.com/vail-systems/node-fft#license