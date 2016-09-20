var _ = require('eakwell');

var Wavetape = function() {
  var self = this;

  if(!Wavetape.hasAudio) return;

  var measureRate = 150;
  var pulseLength = 2;
  var frequency = 12000
  var bufferLength = 1024 * 8;
  var waitTime = 990;
  
  var filterKernel = 32;
  var downsampleFactor = 8;
  var numMeasurements = 5;
  
  var ctx = new AudioContext();
  var freqData = new Uint8Array(bufferLength);
  var waveform = new Uint8Array(bufferLength);
  var stream, source, analyser, filter, processor;

  // Send a single pulse from the speaker
  var beep = function() {
    var oc = ctx.createOscillator();
    oc.type = 'sine';
    oc.frequency.value = frequency;
    oc.connect(ctx.destination);
    var t = ctx.currentTime;
    oc.start(t);
    oc.stop(t + pulseLength / 1000);
  };

  // Listen on the microphone
  var listen = function(onReady) {
    // Open audio stream
    navigator.mediaDevices.getUserMedia({audio: true}).then(function(_stream) {
      stream = _stream;
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      filter = ctx.createBiquadFilter();
      processor = ctx.createScriptProcessor(2048, 1, 1);
      // Focus on the frequency band of our pulses
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 50;
      // Create analyser for extracting data from stream
      analyser.fftSize = bufferLength * 2;
      analyser.smoothingTimeConstant = 0;
      // Connect nodes
      source.connect(filter);
      filter.connect(analyser);
      analyser.connect(processor);
      processor.connect(ctx.destination);
      onReady();
    });
  };

  // Return a buffer representing volume
  var convert2volume = function(waveform) {
    return _.map(waveform, function(sample) {
      return sample >= 128 ? (sample / 256.0 - 0.5) * 2 : 0;
    });
  };

  // Smooth out the given buffer
  var smoothen = function(buffer, kernel) {
    return _.map(buffer, function(sample, i) {
      var sum = 0;
      var count = 0;
      for (var j = -kernel; j <= kernel; j++) {
        var other = buffer[i + j];
        if(!isNaN(other)) {
          sum += other;
          count++;
        }
      }
      return count ? sum / count : 0;
    });
  };

  // Take every <n>th sample to create a lower resolution buffer
  var downsample = function(buffer, n) {
    var out = new Array(buffer.length / n);
    for (var i = 0; i < out.length; i++) {
      out[i] = buffer[i * n];
    }
    return out;
  };

  // Return the times and values of all echoes found in buffer
  var detectEcho = function(buffer) {
    // Detect peaks
    var peaks = [];
    for(var i = 1; i < buffer.length - 1; i++) {
      var lastValue = buffer[i - 1];
      var value     = buffer[i];
      var nextValue = buffer[i + 1];
      if(lastValue < value && nextValue < value) {
        peaks.push({
          value: value,
          time: (i / ctx.sampleRate) * downsampleFactor
        });
      }
    }
    if(!peaks.length >= 2) return;
    // Filter significant peaks
    var max = Math.max.apply(null, _.map(peaks, 'value'));
    var cutOff = max * 0.2;
    peaks = _.select(peaks, function(spike) {
      return spike.value > cutOff;
    });
    // Remove pulse itself
    var pulse = peaks.shift();
    // Find the strongest echo
    var echo = _.maxBy(peaks, function(spike) {
      return spike.value;
    });
    if(pulse && echo) return {
      pulse: pulse,
      echo: echo,
      peaks: peaks
    };
  };

  // Perform a single measurement
  // The audio stream must be running already when calling this function
  var measure = function(cb) {
    // Send pulse
    beep();
    // Wait for echoes to be recorded
    _.defer(function() {
      if(!running) return;
      // Get audio buffer
      analyser.getByteTimeDomainData(waveform);
      // Create a smooth hull around the waveform
      var volume = convert2volume(waveform);
      var smooth = smoothen(volume, filterKernel);
      var miniVolume = downsample(smooth, downsampleFactor);
      var miniKernel = filterKernel / downsampleFactor;
      miniVolume = smoothen(smoothen(miniVolume, miniKernel), miniKernel);
      // Detect echoes
      var signals = detectEcho(miniVolume);
      if(!signals) return;
      // Calculate distance
      var distance = (signals.echo.time - signals.pulse.time) * 340;
      // Return used buffer for visualization
      signals.signal = miniVolume;
      cb(distance, signals);
    }, waitTime);
  };

  var interval;
  var running = false;

  self.start = function(onMeasure, onData) {
    if(running) return;
    running = true;
    var measurements = [];
    // Start listening
    listen(function() {
      // Start sending pulses
      interval = setInterval(function() {
        measure(function(dist, signals) {
          // Collect readings
          measurements.push(dist);
          if(measurements.length == numMeasurements) {
            onMeasure(_.average(measurements));
            measurements.shift();
          }
          onData && onData(signals);
        });
      }, measureRate);
      // Grab audio buffer periodically for debugging purposes
      if(onData) {
        self.onData = onData;
        var loop = function() {
          if(!self.onData) return;
          requestAnimationFrame(loop);
          analyser.getByteFrequencyData(freqData);
          analyser.getByteTimeDomainData(waveform);
          self.onData({
            frequency: freqData,
            waveform: waveform
          });
        };
        loop();
      }
    });
  };

  self.stop = function() {
    running = false;
    self.onData = null;
    clearInterval(interval);
    if(stream) {
      stream.getTracks().forEach(function(track) {
        track.stop();
      });
      source.disconnect();
      filter.disconnect();
      analyser.disconnect();
      processor.disconnect();
      stream = null;
    }
  };
};

// Shim for older implementations of getUserMedia
if(typeof navigator != 'undefined') {
  navigator.mediaDevices = navigator.mediaDevices || ((navigator.mozGetUserMedia || navigator.webkitGetUserMedia || navigator.msGetUserMedia) ? {
    getUserMedia: function(c) {
      return new Promise(function(y, n) {
        (navigator.mozGetUserMedia || navigator.webkitGetUserMedia || navigator.msGetUserMedia).call(navigator, c, y, n);
      });
    }
  } : null);
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
}

Wavetape.hasAudio = typeof(navigator) != 'undefined' && !!navigator.mediaDevices;

module.exports = Wavetape;