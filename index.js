const _ = require("underscore");
const GPIO = require("rpi-gpio");

var Service, Characteristic, HomebridgeAPI;

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;

  homebridge.registerAccessory("homebridge-electromagnetic-lock-with-reed-switch", "ElectromagneticLockContact", ElectromagneticLockAccessory);
};

const LOCK_UNSECURED = 0;
const LOCK_SECURED = 1;
const LOCK_JAMMED = 2;
const LOCK_UNKNOWN = 3;

const DOOR_DETECTED = 0;
const DOOR_NOT_DETECTED = 1;

const DEFAULT_CONFIG = {
  lockPin: 37,
  buzzerPin: 38,
  doorPin: 4,
  tamperPin: 5,
  tamperCheck: false,
  doorAlarm: false,
  activeLow: false,
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
    this.doorAlarm = config.doorAlarm;
    this.activeLow = config.activeLow;
    this.unlockingDuration = config.unlockingDuration;
    this.pollingInterval = config.pollingInterval;

    this.doorState = DOOR_DETECTED;
    this.currentState = LOCK_SECURED;
    this.targetState = LOCK_SECURED;

    this.jammedTimeout;
    this.unlockInterval;
    this.openDoorTimeout;

    this.lockService = new Service.LockMechanism(this.name);
    this.doorService = new Service.ContactSensor(this.doorName);
    this.infoService = new Service.AccessoryInformation();

    try {
      this.setupGPIO();
      this.setupServices();
    } catch (error) {
      console.error(`Error: ${error}`);
    }
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
      .setCharacteristic(Characteristic.FirmwareRevision, "1.0.4");
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
    GPIO.read(this.doorPin, (err, value) => {
      if (err) {
        this.log(`Error reading GPIO Pin ${inputPin}: ${err}`);
      } else {
        const state = value ? DOOR_DETECTED : DOOR_NOT_DETECTED;
        this.updateDoorState(state);
      }  
    });
  }

  handleDoorStateChange(channel, value) {
    if (channel === this.doorPin) {
      const state = value ? DOOR_DETECTED : DOOR_NOT_DETECTED;

      if (state == DOOR_DETECTED && this.currentState != LOCK_SECURED && this.targetState == LOCK_SECURED) {
        clearInterval(this.unlockInterval);
        this.currentState = LOCK_SECURED;
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      }

      if (state !== this.doorState) {        
        this.updateDoorState(state);
      }

      if (this.doorAlarm && state === DOOR_NOT_DETECTED) {
        this.openDoorTimeout = setTimeout(this.openDoorAlarm, this.unlockingDuration * 1000 * 3);
      } else if (this.doorAlarm) {
        clearTimeout(this.openDoorTimeout);
      }
    }

    if (this.tamperCheck && channel === this.tamperPin) {
      const tamperDetected = value === 0;
      this.log(`Tamper state changed: ${tamperDetected ? "Tampered" : "Not Tampered"}`);
      // Update StatusTampered characteristic
      this.updateCharacteristic(Characteristic.StatusTampered, tamperDetected);
    }
  }

  openDoorAlarm(repeatCount = 3) {
    const beep = this.activeLow ? false : true;
    const buzzPattern = [ { value: beep, delay: 0 }, { value: !beep, delay: 5000 }];  
    for (let i = 0; i < repeatCount; i++) {
      for (const { value, delay } of buzzPattern) {
        setTimeout(() => { this.buzzer(value); }, delay + i * 7000);
      }
    }
    this.openDoorTimeout = setTimeout(this.openDoorAlarm, this.unlockingDuration * 1000 * 3);
  }
  
  updateDoorState(newState) {
    const currentTime = Date.now();
    
    if (this.currentState != LOCK_SECURED) {
      if (currentTime - this.doorTimeout <= 500) {
        this.currentState = LOCK_JAMMED;
      } else if (this.currentState == LOCK_JAMMED) {
        this.currentState = LOCK_SECURED;
      } else if (this.currentState == LOCK_UNKNOWN) {
        this.currentState = LOCK_SECURED;
      }
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    } 
    this.doorState = newState;
    this.doorService.updateCharacteristic(Characteristic.ContactSensorState, newState);
    this.doorTimeout = currentTime;
    clearTimeout(this.jammedTimeout);
  }

  setLock(value) {
    GPIO.write(this.lockPin, value, (err) => {
      if (err) {
        this.error(`Error writing to GPIO Pin of lock ${outputPin}: ${err}`);
      }
    });
  }

  buzzer(value) {
    GPIO.write(this.buzzerPin, value, (err) => {
      if (err) {
        this.error(`Error writing to GPIO Pin of buzzer ${outputPin}: ${err}`);
      }
    });
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
    try {
      if (state) {
        clearInterval(this.unlockInterval);
        clearTimeout(this.jammedTimeout);
        this.secureLock();
      } else {
        this.unsecureLock();
      }
    } catch (error) {
      console.error(`Error: ${error}`);
    }
    callback();
  }

  unsecureLock() {
    this.targetState = LOCK_UNSECURED
    this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
    if (this.doorState == DOOR_DETECTED) {
      this.buzzer(this.activeLow ? false : true);
      setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 250);
      setTimeout(() => { this.buzzer(this.activeLow ? false : false); }, 500);
      setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 750);
      this.setLock(this.activeLow ? false : true); // Released
      this.log("Setting lockPin " + this.lockPin + " to %s", this.activeLow ? "LOW" : "HIGH");
      this.currentState = LOCK_UNSECURED
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      this.unlockInterval = setInterval(this.unsecuredLock.bind(this), this.pollingInterval * 1000);
      this.jammedTimeout = setTimeout(this.jammedLock.bind(this), this.unlockingDuration * 1000);
    } else {
      this.buzzer(this.activeLow ? false : true);
      this.currentState = LOCK_UNSECURED
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      setTimeout(() => { 
        this.buzzer(this.activeLow ? true : false); 
        this.currentState = LOCK_SECURED
        this.targetState = LOCK_SECURED
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
        this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
      }, 1000);
    }
  }

  secureLock() {
    this.setLock(this.activeLow ? true : false);
    this.targetState = LOCK_SECURED
    this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);

    if (this.doorState == DOOR_DETECTED) {
      this.currentState = LOCK_SECURED;
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      this.log("Setting %s to SECURED", this.name);
      this.buzzer(this.activeLow ? false : true);
      setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 250);
    } else if (this.doorState == DOOR_NOT_DETECTED) {
      this.currentState = Characteristic.LOCK_SECURED;
      this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      this.log("Setting %s to SECURED", this.name);
      this.buzzer(this.activeLow ? false : true);
      setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 1000);
    }
  }

  jammedLock() {
    clearInterval(this.unlockInterval);
    if (this.doorState == DOOR_DETECTED && this.currentState == LOCK_UNSECURED) {
      this.setLock(this.activeLow ? true : false);
      this.log("Setting lockPin %s to %s", this.lockPin, this.activeLow ? "HIGH" : "LOW");

      const currentTime = Date.now();
      if (currentTime - this.doorTimeout >= this.unlockingDuration * 1000) {
        setTimeout(() => { this.buzzer(this.activeLow ? false : true); }, 1000);
        setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 2000);
        this.currentState = LOCK_JAMMED;
        this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
      }
    }
  }

  unsecuredLock() {
    this.log("Door reed switch %s is %s", this.doorPin, this.doorState == DOOR_DETECTED ? "CLOSED" : "OPEN");
    if (this.doorState == DOOR_DETECTED) {
      if (this.targetState == LOCK_SECURED) {
        if (this.currentState != LOCK_SECURED) {
          this.currentState = LOCK_SECURED;
          this.lockService.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
        }
        clearInterval(this.unlockInterval);
      } else {
        this.buzzer(this.activeLow ? false : true);
        setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 250);
        setTimeout(() => { this.buzzer(this.activeLow ? false : false); }, 500);
        setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 750);
      }
    } else if (this.doorState == DOOR_NOT_DETECTED) {
      if (this.targetState == LOCK_UNSECURED) {
        this.setLock(this.activeLow ? true : false);
        this.buzzer(this.activeLow ? false : true);
        setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 250);
        this.log("Setting lockPin %s to %s", this.lockPin, this.activeLow ? "LOW" : "HIGH");
        this.targetState = LOCK_SECURED;
        this.lockService.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
        clearTimeout(this.jammedTimeout);
      } else {
        const currentTime = Date.now();
        if (currentTime - this.doorTimeout > this.unlockingDuration * 1000) {
          this.buzzer(this.activeLow ? false : true);
          setTimeout(() => { this.buzzer(this.activeLow ? true : false); }, 500);
        }
      }
    }
  }

  getServices() {
    return [this.infoService, this.lockService, this.doorService];
  }
}
