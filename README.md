# Homebridge GPIO Electromagnetic Lock

Homebridge plugin to control electromagnetic lock via Raspberry Pi GPIO pins.

## Objective

Electromagnetic lock working with wiringpi

## Installation

1. install homebridge
   `npm install -g homebridge`
2. install this plugin
   `npm install -g homebridge-wiringpi-electromagnetic-lock`
3. update your `~/.homebridge/config.json` file (use `sample-config.json` as a reference)

## Configuration

Sample accessory:

```
"accessories": [
  {
    "accessory": "ElectromagneticLock",
    "name": "Lock",
    "lockPin": 5,
    "activeLow": true,
    "unlockingDuration": 2
  }
]
```

Fields:

- `accessory` must always be _ElectromagneticLock_
- `name` accessory name, e.g. _Lock_
- `lockPin` pin for unlocking lock (use _gBCM numbering_, run _gpio readall_)
- `activeLow` [optional, default: *true*] true: relay activated by low state (0), false: relay activated by high state (1), affects _lockPin_
- `unlockingDuration` [optional, default: *2*] how long _lockPin_ should be active (seconds)

## Troubleshooting

- check platform: [Homebridge](https://github.com/nfarina/homebridge)
- check plugin dependency: [underscore](Install: npm install underscore -> https://www.npmjs.com/package/underscore)
- check plugin dependency: [rpi-gpio](Install: np install rpi-gpio -> https://www.npmjs.com/package/rpi-gpio)
