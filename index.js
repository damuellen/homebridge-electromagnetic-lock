const _ = require("underscore");
const GPIO = require("rpi-gpio");

const { Service, Characteristic } = HomebridgeAPI.hap;

const LockCurrentState = Characteristic.LockCurrentState;
const ContactSensorState = Characteristic.ContactSensorState;

const DEFAULT_CONFIG = {
  lockPin: 37,
  buzzerPin: 38,
  doorPin: 4,
  tamperPin: 5,
  tamperCheck: false,
  activeLow: true,
  unlockingDuration: 40,
  pollingInterval: 2,
};

class ElectromagneticLockAccessory {
  constructor(log, config) {
    _.defaults(config, DEFAULT_CONFIG);

    this.log = log;
    this.name = config.name;
    this.doorName = config.doorName;
    this.lockPin = config.lockPin;
    this.buzzerPin = config.buzzerPin;
    this.doorPin = config.doorPin;
    this.tamperPin = config.tamperPin;
    this.tamperCheck = config.tamperCheck;
    this.activeLow = config.activeLow;
    this.unlockingDuration = config.unlockingDuration;
    this.pollingInterval = config.pollingInterval;

    this.doorState = ContactSensorState.DETECTED;
    this.currentState = LockCurrentState.SECURED;
    this.targetState = this.currentState;

    this.lockService = new Service.LockMechanism(this.name);
    this.doorService = new Service.ContactSensor(this.doorName);
    this.infoService = new Service.AccessoryInformation();

    this.setupGPIO();
    this.setupServices();
  }

  setupGPIO() {
    GPIO.setup(this.lockPin, this.activeLow ? GPIO.DIR_HIGH : GPIO.DIR_LOW);
    GPIO.setup(this.buzzerPin, this.activeLow ? GPIO.DIR_HIGH : GPIO.DIR_LOW);
    GPIO.setup(this.doorPin, GPIO.DIR_IN, GPIO.EDGE_BOTH);
    if (this.tamperCheck) {
      GPIO.setup(this.tamperPin, GPIO.DIR_IN, GPIO.EDGE_BOTH);
    }
    GPIO.on('change', this.handleDoorStateChange.bind(this));
  }

  setupServices() {
    this.setupLockService();
    this.setupDoorService();
    this.setupAccessoryInformationService();
  }

  setupAccessoryInformationService() {
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "Quantum Ultra Lock Technologies")
      .setCharacteristic(Characteristic.Model, "RaspberryPi GPIO Electromagnetic lock with door contact")
      .setCharacteristic(Characteristic.SerialNumber, "694475915589468")
      .setCharacteristic(Characteristic.FirmwareRevision, "0.9.0");
  }

  setupLockService() {
    this.lockService.getCharacteristic(Characteristic.LockCurrentState)
      .on("get", this.getCurrentLockState.bind(this));

    this.lockService.getCharacteristic(Characteristic.LockTargetState)
      .on("get", this.getTargetLockState.bind(this))
      .on("set", this.setTargetLockState.bind(this));
  }

  setupDoorService() {
    this.doorService.getCharacteristic(Characteristic.ContactSensorState)
      .on("get", this.getDoorState.bind(this));
    if (this.tamperCheck) {
      this.doorService.addCharacteristic(Characteristic.StatusTampered);
    }
  }

  handleDoorStateChange(channel, value) {
    if (channel === this.doorPin) {
      const state = value ? ContactSensorState.DETECTED : ContactSensorState.NOT_DETECTED;

      if (state == ContactSensorState.DETECTED && this.currentState != LockCurrentState.SECURED && this.targetState == LockCurrentState.SECURED) {
        clearInterval(this.unlockTimeout);
        this.currentState = LockCurrentState.SECURED;
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      }

      if (state !== this.doorState) {        
        this.updateDoorState(state);
      }
    }

    if (this.tamperCheck && channel === this.tamperPin) {
      const tamperDetected = value === 0;
      this.log(`Tamper state changed: ${tamperDetected ? "Tampered" : "Not Tampered"}`);
      // Update StatusTampered characteristic
      this.updateCharacteristic(Characteristic.StatusTampered, tamperDetected);
    }
  }

  updateDoorState(newState) {
    const currentTime = Date.now();
    
    if (this.currentState != LockCurrentState.SECURED) {
      if (currentTime - this.doorTimeout <= 500) {
        this.currentState = LockCurrentState.JAMMED;
      } else if (this.currentState == LockCurrentState.JAMMED) {
        this.currentState = LockCurrentState.SECURED;
      } else if (this.currentState == LockCurrentState.UNKNOWN) {
        this.currentState = LockCurrentState.SECURED;
      }
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    } 
    this.doorState = newState;
    this.doorService.updateCharacteristic(Characteristic.ContactSensorState, newState);
    this.doorTimeout = currentTime;
    clearTimeout(this.jammedTimeout);
  }

  getCurrentLockState(callback) {
    this.log("Lock current state: %s", this.currentState);
    callback(undefined, this.currentState);
  }

  getTargetLockState(callback) {
    this.log("Lock target state: %s", this.targetState);
    callback(undefined, this.targetState);
  }

  getDoorState(callback) {
    this.log("Door current state: %s", this.doorState);
    callback(undefined, this.doorState);
  }

  setTargetLockState(state, callback) {
    this.log("Setting %s to %s", this.name, state ? "SECURED" : "UNSECURED");

    if (state) {
      clearInterval(this.unlockTimeout);
      clearTimeout(this.jammedTimeout);
      this.secureLock();
    } else {
      this.unsecureLock();
    }

    callback();
  }

  unsecureLock() {
    this.targetState = LockCurrentState.UNSECURED
    this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
    if (this.doorState == ContactSensorState.DETECTED) {
      GPIO.write(this.buzzerPin, this.activeLow ? false : true);
      setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? true : false); }, 250);
      setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? false : false); }, 500);
      setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? true : false); }, 750);
      GPIO.write(this.lockPin, this.activeLow ? false : true); // Released
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "LOW" : "HIGH");
      this.currentState = LockCurrentState.UNSECURED
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      this.unlockTimeout = setInterval(this.unsecuredLock.bind(this), this.pollingInterval * 1000)
      this.jammedTimeout = setTimeout(this.jammedLock.bind(this), this.unlockingDuration * 1000);
    } else {
      GPIO.write(this.buzzerPin, this.activeLow ? false : true);
      this.currentState = LockCurrentState.UNSECURED
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      setTimeout(() => { 
        GPIO.write(this.buzzerPin, this.activeLow ? true : false); 
        this.currentState = LockCurrentState.SECURED
        this.targetState = LockCurrentState.SECURED
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
        this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
      }, 1000);
    }
  }

  secureLock() {
    GPIO.write(this.lockPin, this.activeLow ? true : false);
    this.targetState = LockCurrentState.SECURED
    this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);

    if (this.doorState == ContactSensorState.DETECTED) {
      this.currentState = LockCurrentState.SECURED;
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      this.log("Setting %s to SECURED", this.name);
    } else if (this.doorState == ContactSensorState.NOT_DETECTED) {
      this.currentState = Characteristic.LockCurrentState.UNKNOWN;
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      this.log("Setting %s to UNKNOWN", this.name);
    }
  }

  jammedLock() {
    clearInterval(this.unlockTimeout);
    if (this.doorState == ContactSensorState.DETECTED && this.currentState == LockCurrentState.UNSECURED) {
      GPIO.write(this.lockPin, this.activeLow ? true : false);
      this.log("Setting lockPin %s to %s", this.lockPin, this.activeLow ? "HIGH" : "LOW");

      const currentTime = Date.now();
      if (currentTime - this.doorTimeout >= this.unlockingDuration * 1000) {
        setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? false : true); }, 1000);
        setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? true : false); }, 2000);
        this.currentState = LockCurrentState.JAMMED;
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      }
    }
  }

  unsecuredLock() {
    this.log("Door reed switch %s is %s", this.doorPin, this.doorState == ContactSensorState.DETECTED ? "CLOSED" : "OPEN");
    if (this.doorState == ContactSensorState.DETECTED) {
      if (this.targetState == LockCurrentState.SECURED) {
        this.currentState = LockCurrentState.SECURED;
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
        clearInterval(this.unlockTimeout);
      } else {
        GPIO.write(this.buzzerPin, this.activeLow ? false : true);
        setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? true : false); }, 250);
        setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? false : false); }, 500);
        setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? true : false); }, 750);
      }
    } else if (this.doorState == ContactSensorState.NOT_DETECTED) {
      if (this.targetState == LockCurrentState.UNSECURED) {
        GPIO.write(this.lockPin, this.activeLow ? true : false);
        GPIO.write(this.buzzerPin, this.activeLow ? false : true);
        setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? true : false); }, 250);
        this.log("Setting lockPin %s to %s", this.lockPin, this.activeLow ? "LOW" : "HIGH");
        this.targetState = LockCurrentState.SECURED;
        this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
        clearTimeout(this.jammedTimeout);
      } else {
        const currentTime = Date.now();
        if (currentTime - this.doorTimeout > this.unlockingDuration * 1000) {
          GPIO.write(this.buzzerPin, this.activeLow ? false : true);
          setTimeout(() => { GPIO.write(this.buzzerPin, this.activeLow ? true : false); }, 500);
        }
      }
    }
  }

  getServices() {
    return [this.infoService, this.lockService, this.doorService];
  }
}

module.exports = (homebridge) => {
  HomebridgeAPI = homebridge;
  homebridge.registerAccessory("homebridge-electromagnetic-lock-with-reed-switch", "ElectromagneticLockContact", ElectromagneticLockAccessory);
};
