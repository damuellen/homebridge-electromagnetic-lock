var _ = require("underscore");

var Service, Characteristic, HomebridgeAPI;

var GPIO = require("rpi-gpio");

const STATE_UNSECURED = 0;
const STATE_SECURED = 1;
const STATE_JAMMED = 2;
const STATE_UNKNOWN = 3;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;

  homebridge.registerAccessory("homebridge-electromagnetic-lock", "ElectromagneticLock", ElectromagneticLockAccessory);
};

function ElectromagneticLockAccessory(log, config) {
  _.defaults(config, { activeLow: true, unlockingDuration: 2 });

  this.log = log;
  this.name = config["name"];
  this.lockPin = config["lockPin"];
  this.activeLow = config["activeLow"];
  this.unlockingDuration = config["unlockingDuration"];

  this.cacheDirectory = HomebridgeAPI.user.persistPath();
  this.storage = require("node-persist");
  this.storage.initSync({ dir: this.cacheDirectory, forgiveParseErrors: true });

  var cachedCurrentState = this.storage.getItemSync(this.name);
  if (cachedCurrentState === undefined || cachedCurrentState === false) {
    this.currentState = STATE_UNKNOWN;
  } else {
    this.currentState = cachedCurrentState;
  }

  this.lockState = this.currentState;
  if (this.currentState == STATE_UNKNOWN) {
    this.targetState = STATE_SECURED;
  } else {
    this.targetState = this.currentState;
  }

  this.service = new Service.LockMechanism(this.name);

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, "Adrian Mihai")
    .setCharacteristic(Characteristic.Model, "RaspberryPi GPIO Electromagnetic Lock")
    .setCharacteristic(Characteristic.SerialNumber, "Version 1.0.0");

  this.unlockTimeout;

  GPIO.MODE_RPI;
  GPIO.setup(this.lockPin, this.activeLow ? GPIO.DIR_HIGH : GPIO.DIR_LOW);
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
    clearTimeout(this.unlockTimeout);
    this.secureLock();
    callback();
  } else {
    this.log("Setting " + this.name + " to %s", state ? "STATE_SECURED" : "STATE_UNSECURED");
    GPIO.write(this.lockPin, this.activeLow ? false : true);
    //this.log("Setting lockPin " + this.lockPin + " to state %s", this.activeLow ? "LOW" : "HIGH");
    this.service.setCharacteristic(Characteristic.LockCurrentState, state);
    this.lockState = state;
    this.storage.setItemSync(this.name, this.lockState);
    this.unlockTimeout = setTimeout(this.secureLock.bind(this), this.unlockingDuration * 1000);
    callback();
  }
};

ElectromagneticLockAccessory.prototype.secureLock = function () {
  this.log("Setting " + this.name + " to STATE_SECURED");
  GPIO.write(this.lockPin, this.activeLow ? true : false);
  //this.log("Setting lockPin " + this.lockPin + " to state %s", this.activeLow ? "HIGH" : "LOW");
  this.service.updateCharacteristic(Characteristic.LockTargetState, STATE_SECURED);
  this.service.updateCharacteristic(Characteristic.LockCurrentState, STATE_SECURED);
  this.currentState = STATE_SECURED;
  this.targetState = STATE_SECURED;
  this.storage.setItemSync(this.name, this.currentState);
};

ElectromagneticLockAccessory.prototype.getServices = function () {
  return [this.infoService, this.service];
};
