# homebridge-electromagnetic-lock

This Homebridge plugin allows you to control an electromagnetic lock connected to a Raspberry Pi GPIO pin. The plugin monitors the lock and door status, providing secure and convenient control through HomeKit.

## Installation

1. Install Homebridge using `npm install -g homebridge`
2. Install this plugin using `npm install -g homebridge-electromagnetic-lock-with-reed-switch`
3. Update your Homebridge configuration file to include the `ElectromagneticLock` accessory. See the example below.

## Configuration

Add the following information to your Homebridge `config.json` file:

```json
"accessories": [
  {
    "accessory": "ElectromagneticLock",
    "name": "Türöffner",
    "doorName": "Haustür",
    "lockPin": 37,
    "buzzerPin": 38,
    "doorPin": 4,
    "activeLow": true,
    "unlockingDuration": 40,
    "pollingInterval": 2
  }
]
```
- **name**: The name of the accessory as it will appear in HomeKit.
- **doorName**: The name of the accessory as it will appear in HomeKit.
- **lockPin**: The GPIO pin connected to the electromagnetic lock.
- **buzzerPin**: The GPIO pin connected to the active buzzer.
- **doorPin**: The GPIO pin connected to the reed switch on the door.
- **activeLow**: Set to `true` if the GPIO pin operates with active low logic.
- **unlockingDuration**: The duration, in seconds, for which the lock remains unlocked.
- **pollingInterval**: The interval, in seconds, at which the plugin checks the door status.

## Usage

Once configured, the electromagnetic lock accessory will appear in your HomeKit app. You can control and monitor the lock's state, and the plugin will handle the unlocking and jammed scenarios based on the door status.

## Accessory Information

The accessory information, such as manufacturer, model, and version, is also provided for better identification in HomeKit.

### Manufacturer: Quantum Ultra Lock Technologies
### Model: RaspberryPi GPIO Electromagnetic lock with door contact
### FirmwareRevision 0.8.0

## Acknowledgments

This plugin utilizes the [rpi-gpio](https://www.npmjs.com/package/rpi-gpio) package to interface with the Raspberry Pi GPIO.
