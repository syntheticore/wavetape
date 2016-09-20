# wavetape.js
[![npm version](https://badge.fury.io/js/wavetape.svg)](http://badge.fury.io/js/wavetape)

Measure distances using your mobile device's microphone and speaker

## Installation

    npm install wavetape --save

## Usage

  ```JavaScript
  var Wavetape = require('wavetape');

  var echolot = new Wavetape();
  echolot.start(function(distance) {
    console.log("The closest obstacle is now " + distance.toFixed(2) + " meters away");
    echolot.stop();
  });

## License

  MIT

