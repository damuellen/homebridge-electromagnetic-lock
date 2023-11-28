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
  _.defaults(config, { lockPin: 37, doorPin: 4, activeLow: true, unlockingDuration: 40 , pollingInterval: 2 });

  this.log = log;
  this.name = config["name"];
  this.doorName = "Haustür";
  this.lockPin = config["lockPin"];
  this.doorPin = config['doorPin'];
  this.activeLow = config["activeLow"];
  this.unlockingDuration = config["unlockingDuration"];
  this.pollingInterval = config["pollingInterval"];

  this.cacheDirectory = HomebridgeAPI.user.persistPath();
  this.storage = require("node-persist");
  this.storage.initSync({ dir: this.cacheDirectory, forgiveParseErrors: true });

  var cachedCurrentState = this.storage.getItemSync(this.name);
  if (cachedCurrentState === undefined || cachedCurrentState === false) {
    this.currentState = _UNKNOWN;
  } else {
    this.currentState = cachedCurrentState;
  }
  var cachedDoorState = this.storage.getItemSync(this.doorName);
  if (cachedDoorState === undefined || cachedDoorState === false) {
    this.doorState = _NOT_DETECTED;
  } else {
    this.doorState = cachedDoorState;
  }

  this.lockState = this.currentState;
  if (this.currentState == _UNKNOWN) {
    this.targetState = _SECURED;
  } else {
    this.targetState = this.currentState;
  }

  this.lockService = new Service.LockMechanism(this.name);
  this.doorService = new Service.ContactSensor(this.doorName)

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "Müllenborn")
    .setCharacteristic(Characteristic.Model, "RaspberryPi GPIO Electromagnetic lock with reed switch")
    .setCharacteristic(Characteristic.SerialNumber, "Version 0.3.0");

  this.unlockTimeout;
  this.jammedTimeout;

  GPIO.MODE_RPI;
  GPIO.setup(this.lockPin, this.activeLow ? GPIO.DIR_HIGH : GPIO.DIR_LOW);
  GPIO.setup(this.doorPin, GPIO.DIR_IN, GPIO.EDGE_BOTH);
  GPIO.on('change', function(channel, value) {
    if (channel === this.doorPin) {
      this.doorState = value ? _DETECTED : _NOT_DETECTED;
      this.storage.setItemSync(this.doorName, this.doorState);
    }
  });
  //this.log("pin setup complete");

  this.lockService.getCharacteristic(Characteristic.LockCurrentState).on("get", this.getCurrentState.bind(this));

  this.lockService.getCharacteristic(Characteristic.LockTargetState).on("get", this.getTargetState.bind(this)).on("set", this.setTargetState.bind(this));

  this.doorService.getCharacteristic(Characteristic.ContactSensorState).on("get", this.getDoorState.bind(this));
}

ElectromagneticLockAccessory.prototype.getDoorState = function (callback) {
  //this.log("Door current state: %s", this.doorState);
  callback(null, this.doorState);
};

ElectromagneticLockAccessory.prototype.getCurrentState = function (callback) {
  //this.log("Lock current state: %s", this.currentState);
  callback(null, this.currentState);
};

ElectromagneticLockAccessory.prototype.getTargetState = function (callback) {
  //this.log("Lock target state: %s", this.targetState);
  callback(null, this.targetState);
};

ElectromagneticLockAccessory.prototype.setTargetState = function (state, callback) {
  this.log("Setting " + this.name + " to %s", state ? "SECURED" : "UNSECURED");
  if (state) {
    clearTimeout(this.unlockTimeout);
    clearTimeout(this.jammedTimeout);
    this.secureLock();    
    callback();
  } else {
    GPIO.write(this.lockPin, this.activeLow ? false : true); // Open
    this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "LOW" : "HIGH");
    this.lockService.setCharacteristic(Characteristic.LockCurrentState, state);
    this.lockState = state;
    this.storage.setItemSync(this.name, this.lockState);
    this.unlockTimeout = setTimeout(this.unsecuredLock.bind(this), this.pollingInterval * 1000);
    this.jammedTimeout = setTimeout(this.jammedLock.bind(this), this.unlockingDuration * 1000);
    callback();
  }
};

ElectromagneticLockAccessory.prototype.jammedLock = function () {
  if (this.doorState == _DETECTED) {
    if (this.currentState == _UNSECURED) {
      GPIO.write(this.lockPin, this.activeLow ? true : false); // Close
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "HIGH" : "LOW");
      this.service.updateCharacteristic(Characteristic.LockCurrentState, _JAMMED);
      this.currentState = _JAMMED;
      this.storage.setItemSync(this.name, this.currentState);
    }
  }
};

ElectromagneticLockAccessory.prototype.unsecuredLock = function () {
  this.log("Door reed switch" + this.doorPin + " is %s", this.doorState == _DETECTED ? "CLOSED" : "OPEN");
  if (this.doorState == _DETECTED) {
    if (this.targetState == _SECURED) {
      this.service.updateCharacteristic(Characteristic.LockTargetState, _SECURED);
      this.service.updateCharacteristic(Characteristic.LockCurrentState, _SECURED);
      this.targetState = _SECURED;
      this.currentState = _SECURED;
    } 
  } else if (this.doorState == _NOT_DETECTED) {
    if (this.currentState !== _SECURED) {
      GPIO.write(this.lockPin, this.activeLow ? true : false); // Close
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "HIGH" : "LOW");
      this.service.updateCharacteristic(Characteristic.LockTargetState, _SECURED);
      this.service.updateCharacteristic(Characteristic.LockCurrentState, _UNKNOWN);
      this.targetState = _SECURED;
      this.currentState = _UNKNOWN;
      clearTimeout(this.jammedTimeout);
    }
    setTimeout(this.unsecuredLock.bind(this), this.pollingInterval * 1000)
  }
  this.storage.setItemSync(this.name, this.currentState);
};

ElectromagneticLockAccessory.prototype.secureLock = function () {
  GPIO.write(this.lockPin, this.activeLow ? true : false);
  this.lockService.updateCharacteristic(Characteristic.LockTargetState, _SECURED);
  if (this.doorState == _DETECTED) {
    this.lockService.updateCharacteristic(Characteristic.LockCurrentState, _SECURED);
    this.currentState = _SECURED;
    this.log("Setting " + this.name + " to SECURED");
  } else if (this.doorState == _NOT_DETECTED) {
    this.lockService.updateCharacteristic(Characteristic.LockCurrentState, _UNKNOWN);
    this.currentState = _UNKNOWN;
    this.log("Setting " + this.name + " to UNKNOWN");
  }
  this.targetState = _SECURED;
  this.storage.setItemSync(this.name, this.currentState);
};

ElectromagneticLockAccessory.prototype.getServices = function () {
  return [this.infoService, this.lockService, this.doorService];
};
