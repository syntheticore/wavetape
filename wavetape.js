var _ = require('eakwell');

var Wavetape = function() {
  var self = this;

  if(!Wavetape.hasAudio) return;

  self.measureTime = 120;
  self.pulseLength = 4;
  self.frequency = 10859;

  self.bufferLength = 256;
  self.filterKernel = 32;
  self.downsampleFactor = 16;
  self.minAmplitude = 0.02;
  self.numMeasurements = 12;

  self.temperature = 20; // °C
  
  var ctx = new AudioContext();
  var stream, source, filter, processor;

  // Send a single pulse from the speaker
  var pulse = function() {
    var oc = ctx.createOscillator();
    oc.type = 'sine';
    oc.frequency.value = self.frequency;
    oc.connect(ctx.destination);
    var t = ctx.currentTime;
    oc.start(t);
    oc.stop(t + self.pulseLength / 1000);
  };

  // Listen on the microphone
  var listen = function(cb) {
    // Open audio stream
    navigator.mediaDevices.getUserMedia({audio: true}).then(function(_stream) {
      stream = _stream;
      source = ctx.createMediaStreamSource(stream);
      filter = ctx.createBiquadFilter();
      processor = ctx.createScriptProcessor(self.bufferLength, 1, 1);
      // Focus on the frequency band of our pulses
      filter.type = 'bandpass';
      filter.frequency.value = self.frequency;
      filter.Q.value = 50;
      // Connect nodes
      source.connect(filter);
      filter.connect(processor);
      processor.connect(ctx.destination);
      // Record the signal
      var record = [];
      var recording = false;
      var recordLength = getRecordLength();
      processor.onaudioprocess = function(e) {
        var buffer = e.inputBuffer.getChannelData(0);
        if(record.length < recordLength) {
          var volume = convert2volume(buffer);
          if(recording) {
            record = record.concat(volume);
          } else {
            // Find start of pulse
            if(_.any(volume, function(sample) {
              return sample > self.minAmplitude;
            })) {
              recording = true;
              // Prepad with zeroes,
              // in case we are starting right in the pulse itself
              record = record.concat(new Array(self.filterKernel).fill(0));
              record = record.concat(volume);
            }
          }
        } else {
          cb(record);
          record = [];
          recording = false;
        }
      };
    });
  };

  // Return the actual number samples recorded for every pulse
  var getRecordLength = function() {
    return ctx.sampleRate * (self.measureTime / 1000) - self.bufferLength * 4;
  };

  // Make a buffer representing volume from the raw <waveform>
  var convert2volume = function(waveform) {
    return _.map(waveform, function(sample, i) {
      return (sample > 0 ? sample : -sample);
    });
  };

  // Return the average value of <kernel> samples around <i>
  var smoothenSample = function(buffer, i, kernel) {
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
  };

  // Smooth out the given <buffer> over <kernel>
  var smoothen = function(buffer, kernel) {
    return _.map(buffer, function(sample, i) {
      return smoothenSample(buffer, i, kernel);
    });
  };

  // Take every <n>th sample to create a lower resolution buffer
  var downsample = function(buffer, kernel, n) {
    var out = new Array(buffer.length / n);
    for(var i = 0; i < out.length; i++) {
      out[i] = smoothenSample(buffer, i * n, kernel);
    }
    return out;
  };

  // Return the times and amplitudes of all echoes found in <buffer>
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
          index: i,
          time: (i / ctx.sampleRate) * self.downsampleFactor
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

  // Return the speed of sound in m/s
  var speedOfSound = function() {
    return 331.3 + (0.6 * self.temperature);
  };

  // Return the distance to the next obstacle in meters,
  // based on the relative times of a pulse and its echo
  var getDistance = function(pulse, echo) {
    return (echo.time - pulse.time) * speedOfSound() / 2;
  };

  // Return measurements continuously
  var measure = function(cb) {
    // Start sending pulses
    interval = setInterval(pulse, self.measureTime);
    // Start listening
    listen(function(buffer) {
      // Downsample and smoothen the buffer
      buffer = downsample(buffer, self.filterKernel, self.downsampleFactor);
      var miniKernel = Math.round(self.filterKernel / self.downsampleFactor);
      buffer = smoothen(buffer, miniKernel);
      // Detect echoes
      var signals = detectEcho(buffer);
      if(!signals) return;
      // Calculate distance
      var distance = getDistance(signals.pulse, signals.echo);
      // Return used buffer for visualization
      signals.signal = buffer;
      cb(distance, signals);
    });
  };

  var interval;
  var running = false;

  // Start measuring until stopped
  self.start = function(onMeasure, onData) {
    if(running) return;
    running = true;
    var measurements = [];
    measure(function(dist, signals) {
      // Collect readings
      measurements.push(dist);
      while(measurements.length > self.numMeasurements) {
        measurements.shift();
      }
      // Return average measurement
      if(measurements.length) onMeasure(_.average(measurements));
      // Return debugging data
      onData && onData(signals);
    });
  };

  // Stop sending and listening
  self.stop = function() {
    running = false;
    clearInterval(interval);
    if(stream) {
      stream.getTracks().forEach(function(track) {
        track.stop();
      });
      source.disconnect();
      filter.disconnect();
      processor.disconnect();
      stream = null;
    }
  };

  // Return the maximum distance that can be measured in meters,
  // based on the current measuring rate and temperature
  self.getRange = function() {
    var minDuration = self.pulseLength / 1000 + self.filterKernel * 2 / ctx.sampleRate;
    var maxDuration = getRecordLength() / ctx.sampleRate;
    return {
      min: speedOfSound() * minDuration / 2,
      max: speedOfSound() * maxDuration / 2
    };
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
