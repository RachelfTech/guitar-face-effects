A [website](https://rachelf.com/guitar-face-effects/) where you can control 
guitar effects by moving your mouth. Now you can put your guitar faces to good 
use 😁!

How well this works varies between browsers and OS combinations. I've mostly tested
on Windows with Chrome, but Windows unfortunately has a lot of latency due to
how the audio driver system works. Mac OS with Chrome has much better latency,
but some of the effects don't work as well (pitch shifting in particular).

You'll need a webcam and it will also work best if you have an audio interface 
and select that as the mic input. I've primarily tested with an interface 
(Scarlet Focusrite 2i2) so I'm not sure if it will really work without one.
Make sure to allow both mic and webcam permissions browser permissions; if
it's not loading, the lack of permissions could be why.

This is just for fun and I haven't tested it super thouroughly, so apologies if 
it doesn't work for your particular setup!

This project uses the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) 
for the effects with [ml5.js](https://github.com/ml5js/ml5-library) for face 
tracking.

The pitch shifting is from https://github.com/olvb/phaze.

#### Dependency licenses

ml5.js: https://ml5js.org/license  
fft.js: https://github.com/vail-systems/node-fft#license
