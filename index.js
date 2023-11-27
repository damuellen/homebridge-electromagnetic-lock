var _ = require("underscore");

var Service, Characteristic, HomebridgeAPI;

var GPIO = require("rpi-gpio");

const _UNSECURED = 0;
const _SECURED = 1;
const _JAMMED = 2;
const _UNKNOWN = 3;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;

  homebridge.registerAccessory("homebridge-electromagnetic-lock", "ElectromagneticLock", ElectromagneticLockAccessory);
};

function ElectromagneticLockAccessory(log, config) {
  _.defaults(config, { lockPin: 37, doorPin: 4, activeLow: true, unlockingDuration: 40 , pollingInterval: 2 });

  this.log = log;
  this.name = config["name"];
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

  this.lockState = this.currentState;
  if (this.currentState == _UNKNOWN) {
    this.targetState = _SECURED;
  } else {
    this.targetState = this.currentState;
  }

  this.service = new Service.LockMechanism(this.name);

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "Müllenborn")
    .setCharacteristic(Characteristic.Model, "RaspberryPi GPIO Electromagnetic lock with reed switch")
    .setCharacteristic(Characteristic.SerialNumber, "Version 0.1.1");

  this.unlockTimeout;
  this.jammedTimeout;
  this.openTimeout;
 
  GPIO.MODE_RPI;
  GPIO.setup(this.lockPin, this.activeLow ? GPIO.DIR_HIGH : GPIO.DIR_LOW);
  GPIO.setup(this.doorPin, GPIO.DIR_IN)
  //this.log("pin setup complete");

  this.service.getCharacteristic(Characteristic.LockCurrentState).on("get", this.getCurrentState.bind(this));

  this.service.getCharacteristic(Characteristic.LockTargetState).on("get", this.getTargetState.bind(this)).on("set", this.setTargetState.bind(this));
}

ElectromagneticLockAccessory.prototype.getCurrentState = function (callback) {
  //this.log("Lock current state: %s", this.currentState);
  callback(null, this.currentState);
};

ElectromagneticLockAccessory.prototype.getTargetState = function (callback) {
  //this.log("Lock target state: %s", this.targetState);
  callback(null, this.targetState);
};

ElectromagneticLockAccessory.prototype.setTargetState = function (state, callback) {
  if (state) {
    clearInterval(this.unlockTimeout);
    clearTimeout(this.jammedTimeout);
    this.secureLock();    
    callback();
  } else {
    this.log("Setting " + this.name + " to %s", state ? "STATE_SECURED" : "STATE_UNSECURED");
    GPIO.write(this.lockPin, this.activeLow ? false : true); // Open
    //this.log("Setting lockPin " + this.lockPin + " to state %s", this.activeLow ? "LOW" : "HIGH");
    this.service.setCharacteristic(Characteristic.LockCurrentState, state);
    this.lockState = state;
    this.storage.setItemSync(this.name, this.lockState);
    this.unlockTimeout = setInterval(this.unsecuredLock.bind(this), this.pollingInterval * 1000);
    this.jammedTimeout = setTimeout(this.jammedLock.bind(this), this.unlockingDuration * 1000);
    callback();
  }
};

ElectromagneticLockAccessory.prototype.jammedLock = function () {
  GPIO.read(this.doorPin, function(err, value) {
    if (err) throw err;
    if (value) {
      if (this.currentState == _UNSECURED) {
        GPIO.write(this.lockPin, this.activeLow ? true : false); // Close
        this.service.updateCharacteristic(Characteristic.LockCurrentState, _JAMMED);
        this.currentState = _JAMMED;
        this.storage.setItemSync(this.name, this.currentState);
      }
    }
  });
};

ElectromagneticLockAccessory.prototype.unsecuredLock = function () {
  GPIO.read(this.doorPin, function(err, value) {
    if (err) throw err;
    if (value) {
      if (this.targetState == _SECURED) {
        this.service.updateCharacteristic(Characteristic.LockTargetState, _SECURED);
        this.service.updateCharacteristic(Characteristic.LockCurrentState, _SECURED);
        this.targetState = _SECURED;
        this.currentState = _SECURED;
      } 
      if (this.currentState == _SECURED) {
        clearInterval(this.unlockTimeout);
        clearTimeout(this.jammedTimeout);
      }
    } else {
      if (this.currentState == _UNSECURED) {
        GPIO.write(this.lockPin, this.activeLow ? true : false); // Close
        this.service.updateCharacteristic(Characteristic.LockTargetState, _SECURED);
        this.targetState = _SECURED;
        clearTimeout(this.jammedTimeout);
      }
    }
    this.storage.setItemSync(this.name, this.currentState);
  });
};

ElectromagneticLockAccessory.prototype.secureLock = function () {
  this.log("Setting " + this.name + " to STATE_SECURED");
  GPIO.write(this.lockPin, this.activeLow ? true : false);
  this.service.updateCharacteristic(Characteristic.LockTargetState, STATE_SECURED);
  this.service.updateCharacteristic(Characteristic.LockCurrentState, STATE_SECURED);
  this.currentState = STATE_SECURED;
  this.targetState = STATE_SECURED;
  this.storage.setItemSync(this.name, this.currentState);
};

ElectromagneticLockAccessory.prototype.getServices = function () {
  return [this.infoService, this.service];
};
