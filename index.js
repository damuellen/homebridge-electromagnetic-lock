var _ = require("underscore");

var Service, Characteristic, HomebridgeAPI;

var GPIO = require("rpi-gpio");

const released = Characteristic.LockCurrentState.UNSECURED
const locked = Characteristic.LockCurrentState.SECURED
const doorIsClosed = Characteristic.ContactSensorState.DETECTED;
const doorIsOpen = Characteristic.ContactSensorState.NOT_DETECTED;

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

  this.doorState = doorIsClosed;

  this.currentState = locked;
  this.targetState = this.currentState;
  this.lockService = new Service.LockMechanism(this.name);
  this.doorService = new Service.ContactSensor(this.doorName)

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "Quantum Ultra Lock Technologies")
    .setCharacteristic(Characteristic.Model, "RaspberryPi GPIO Electromagnetic lock with door contact")
    .setCharacteristic(Characteristic.SerialNumber, "694475915589468")
    .setCharacteristic(Characteristic.FirmwareRevision, "0.6.0");

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
      let state = value ? doorIsClosed : doorIsOpen;

      if (state == doorIsClosed && this.currentState != locked && this.targetState == locked) {
        clearInterval(this.unlockTimeout);
        this.currentState = locked
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
          if (this.currentState != locked) {
            this.currentState = Characteristic.LockCurrentState.JAMMED
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
    GPIO.write(this.lockPin, this.activeLow ? false : true); // Released
    this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "LOW" : "HIGH");
    this.lockService.setCharacteristic(Characteristic.LockCurrentState, state);
    this.unlockTimeout = setInterval(this.unsecuredLock.bind(this), this.pollingInterval * 1000)
    if (this.doorState == doorIsClosed) {
      this.jammedTimeout = setTimeout(this.jammedLock.bind(this), this.unlockingDuration * 1000);
    }
    callback();
  }
};

ElectromagneticLockAccessory.prototype.jammedLock = function () {
  if (this.doorState == doorIsClosed) {
    if (this.currentState == released) {
      GPIO.write(this.lockPin, this.activeLow ? true : false); // Close
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "HIGH" : "LOW");
      // Get the current time
      const currentTime = Date.now();
      if (currentTime - this.doorTimeout >= this.unlockingDuration * 1000) {
        this.currentState = Characteristic.LockCurrentState.JAMMED;
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      }
    }
  } 
};

ElectromagneticLockAccessory.prototype.unsecuredLock = function () {
  // Log the current state of the door reed switch
  this.log("Door reed switch " + this.doorPin + " is %s", this.doorState == doorIsClosed ? "CLOSED" : "OPEN");

  // Check if the door is closed (DETECTED state)
  if (this.doorState == doorIsClosed) {
    // Check if the target state is to secure the lock
    if (this.targetState == locked) {
      // Update characteristics and clear unlockTimeout
      this.currentState = locked;
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);      
      clearInterval(this.unlockTimeout);
    }
  } else if (this.doorState == doorIsOpen) { // Check if the door is open (NOT_DETECTED state)
    // Check if the current state is not already secured
    if (this.currentState == released) {
      // Close the lock, update characteristics, and reset states
      GPIO.write(this.lockPin, this.activeLow ? true : false); // Close the lock
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "HIGH" : "LOW");
      this.targetState = locked;
      // this.currentState = Characteristic.LockCurrentState.UNKNOWN;
      this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
      // this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);

    }
  }
};

ElectromagneticLockAccessory.prototype.secureLock = function () {
  // Close the lock by writing to the GPIO pin
  GPIO.write(this.lockPin, this.activeLow ? true : false);  // Close the lock
  // Update the target state characteristic to SECURED
  this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
  // Check the current state of the door reed switch
  if (this.doorState == doorIsClosed) {
    // If the door is closed (doorIsClosed state), update current state to SECURED
    this.currentState = locked;
    this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    this.log("Setting " + this.name + " to SECURED");
  } else if (this.doorState == doorIsOpen) {
    // If the door is open (doorIsOpen state), update current state to UNKNOWN
    this.currentState = Characteristic.LockCurrentState.UNKNOWN;
    this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    this.log("Setting " + this.name + " to UNKNOWN");
  }
};

ElectromagneticLockAccessory.prototype.getServices = function () {
  return [this.infoService, this.lockService, this.doorService];
};
