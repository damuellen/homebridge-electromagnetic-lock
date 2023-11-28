var _ = require("underscore");

var Service, Characteristic, HomebridgeAPI;

var GPIO = require("rpi-gpio");

const _UNSECURED = 0;
const _SECURED = 1;
const _JAMMED = 2;
const _UNKNOWN = 3;

const _DETECTED = 0;
const _NOT_DETECTED = 1;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;

  homebridge.registerAccessory("homebridge-electromagnetic-lock-with-reed-switch", "ElectromagneticLock", ElectromagneticLockAccessory);
};

function ElectromagneticLockAccessory(log, config) {
  _.defaults(config, { lockPin: 37, doorPin: 4, activeLow: true, unlockingDuration: 40, pollingInterval: 2 });

  this.log = log;
  this.name = config["name"];
  this.doorName = config["doorName"];
  this.lockPin = config["lockPin"];
  this.doorPin = config['doorPin'];
  this.activeLow = config["activeLow"];
  this.unlockingDuration = config["unlockingDuration"];
  this.pollingInterval = config["pollingInterval"];

  this.doorState = _DETECTED;

  this.currentState = _SECURED;
  this.targetState = this.currentState;
  this.lockService = new Service.LockMechanism(this.name);
  this.doorService = new Service.ContactSensor(this.doorName)

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "Quantum Ultra Lock Technologies")
    .setCharacteristic(Characteristic.Model, "RaspberryPi GPIO Electromagnetic lock with door contact")
    .setCharacteristic(Characteristic.SerialNumber, "694475915589468")
    .setCharacteristic(Characteristic.FirmwareRevision, "0.5.1");

  this.lockService.getCharacteristic(Characteristic.LockCurrentState)
    .on("get", this.getCurrentState.bind(this));

  this.lockService.getCharacteristic(Characteristic.LockTargetState)
    .on("get", this.getTargetState.bind(this)).on("set", this.setTargetState.bind(this));

  this.doorService.getCharacteristic(Characteristic.ContactSensorState)
    .on("get", this.getDoorState.bind(this));

  this.unlockTimeout;
  this.jammedTimeout;
  this.doorTimeout = 0;

  GPIO.setup(this.lockPin, this.activeLow ? GPIO.DIR_HIGH : GPIO.DIR_LOW);
  GPIO.setup(this.doorPin, GPIO.DIR_IN, GPIO.EDGE_BOTH);
  GPIO.on('change', (channel, value) => {
    // Check if the change occurred in the specified doorPin channel
    if (channel === this.doorPin) {
      // Determine the door state based on the value of the change
      let state = value ? _DETECTED : _NOT_DETECTED;

      if (state == _DETECTED && this.currentState == _UNKNOWN && this.targetState == _SECURED) {
        this.currentState = _SECURED
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      }
      // Check if the detected state is different from the current doorState
      if (state !== this.doorState) {
        // Update the doorState with the new detected state
        this.doorState = state;

        // Get the current time
        const currentTime = Date.now();

        // Check if at least 2 seconds have passed since the last update
        if (currentTime - this.doorTimeout >= this.pollingInterval * 1000) {
          // Update the lastUpdateTime to the current time
          this.doorTimeout = currentTime;
          this.doorService.updateCharacteristic(Characteristic.ContactSensorState, this.doorState);
        } else if (currentTime - this.doorTimeout <= 500) {
          if (this.currentState != _SECURED) {
            this.currentState = _JAMMED
            this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
          }
        }
        // Clear any existing jammedTimeout
        clearTimeout(this.jammedTimeout);
      }
    }
  });
}

ElectromagneticLockAccessory.prototype.getDoorState = function (callback) {
  this.log("Door current state: %s", this.doorState);
  callback(undefined, this.doorState);
};

ElectromagneticLockAccessory.prototype.getCurrentState = function (callback) {
  this.log("Lock current state: %s", this.currentState);
  callback(undefined, this.currentState);
};

ElectromagneticLockAccessory.prototype.getTargetState = function (callback) {
  this.log("Lock target state: %s", this.targetState);
  callback(undefined, this.targetState);
};

ElectromagneticLockAccessory.prototype.setTargetState = function (state, callback) {
  this.log("Setting " + this.name + " to %s", state ? "SECURED" : "UNSECURED");
  if (state) {
    clearTimeout(this.unlockTimeout);
    this.secureLock();
    callback();
  } else {
    GPIO.write(this.lockPin, this.activeLow ? false : true); // Open
    this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "LOW" : "HIGH");
    this.lockService.setCharacteristic(Characteristic.LockCurrentState, state);
    this.unlockTimeout = setInterval(this.unsecuredLock.bind(this), this.pollingInterval * 1000)
    if (this.doorState == _DETECTED) {
      this.jammedTimeout = setTimeout(this.jammedLock.bind(this), this.unlockingDuration * 1000);
    }
    callback();
  }
};

ElectromagneticLockAccessory.prototype.jammedLock = function () {
  if (this.doorState == _DETECTED) {
    if (this.currentState == _UNSECURED) {
      GPIO.write(this.lockPin, this.activeLow ? true : false); // Close
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "HIGH" : "LOW");
      // Get the current time
      const currentTime = Date.now();
      if (currentTime - this.doorTimeout >= this.unlockingDuration * 1000) {
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, _JAMMED);
        this.currentState = _JAMMED;
      }
    }
  }
};

ElectromagneticLockAccessory.prototype.unsecuredLock = function () {
  // Log the current state of the door reed switch
  this.log("Door reed switch " + this.doorPin + " is %s", this.doorState == _DETECTED ? "CLOSED" : "OPEN");

  // Check if the door is closed (_DETECTED state)
  if (this.doorState == _DETECTED) {
    // Check if the target state is to secure the lock
    if (this.targetState == _SECURED) {
      // Update characteristics and clear unlockTimeout
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, _SECURED);
      this.currentState = _SECURED;
      clearInterval(this.unlockTimeout);
    }
  } else if (this.doorState == _NOT_DETECTED) { // Check if the door is open (_NOT_DETECTED state)
    // Check if the current state is not already secured
    if (this.currentState == _UNSECURED) {
      // Close the lock, update characteristics, and reset states
      GPIO.write(this.lockPin, this.activeLow ? true : false); // Close the lock
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "HIGH" : "LOW");
      this.targetState = _SECURED;
      this.currentState = _UNKNOWN;
      this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);

    }
  }
};

ElectromagneticLockAccessory.prototype.secureLock = function () {
  // Close the lock by writing to the GPIO pin
  GPIO.write(this.lockPin, this.activeLow ? true : false);  // Close the lock
  // Set the target state to _SECURED
  this.targetState = _SECURED;
  // Update the target state characteristic to _SECURED
  this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
  // Check the current state of the door reed switch
  if (this.doorState == _DETECTED) {
    // If the door is closed (_DETECTED state), update current state to _SECURED
    this.currentState = _SECURED;
    this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    this.log("Setting " + this.name + " to SECURED");
  } else if (this.doorState == _NOT_DETECTED) {
    // If the door is open (_NOT_DETECTED state), update current state to _UNKNOWN
    this.currentState = _UNKNOWN;
    this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    this.log("Setting " + this.name + " to UNKNOWN");
  }
};

ElectromagneticLockAccessory.prototype.getServices = function () {
  return [this.infoService, this.lockService, this.doorService];
};
