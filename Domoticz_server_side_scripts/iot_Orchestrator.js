// @Antori91  http://www.domoticz.com/forum/memberlist.php?mode=viewprofile&u=13749
// ***** Script to :
//        - Manage Heaters and Heating Zones (Scheduled TOP Start/Stop),
//        - Compute and log heaters characteristics,
//        - Monitor ESP8266-ACS712/Heaters, ESP8266/Lighting and Raspberry/Alarm servers *****
// V1.10 - January 2021
           // Change (iot_AC712.js deleted) : Reset Heater meter POWER if Mqtt Will message received
           // Improvement : increase stability against communication and security issues
// V1.0  - March 2020
           // Monitor Dahua VTH box and secpanel. If failure, raise "Panne Alarme" - idxAlarmFailureFlag Dz device
// V0.95 - April 2019
           // Monitor the new Fire Alarm server. If failure, raise "Panne Alarme" - idxAlarmFailureFlag Dz device
// V0.91 - February 2019
           // Improvement : Use command-line argument to define execution hardware (i.e. avoid a slightly different version per platform)
// V0.9 - August 2018
           // Monitor the new Node.js Alarm server. If failure, raise "Panne Alarme" - idxAlarmFailureFlag Dz device
// V0.8 - March 2018
           // Improvement : Failure flag not raised for short duration network issue (i.e. Internet Box/WiFi Extender/Mqtt server reboot) 
// V0.7 - January 2018 
           // Monitor the new Lighting server. If failure, raise "Panne Domotique" - idxFailureFlag Dz device
// V0.5/V0.6 - December 2017 
           // Improvement : Heating Zones Scheduled TOP Start/Stop selector switches set to [Ack] at start up 
           // Improvement : If ESP8266-ACS712 heater failure, log the Heater ID and date/time of failure
           // Improvement : Heating Zones Scheduled TOP Start/Stop selector switches set to [Ack] every hour. More friendly for Android Apps user because then easier to start/stop again the same heating zone 
           // Can be in the future an actual ACK status meaning that we will check status reported by the heaters (For now no MQTT message is assumed to be lost by a heater)
// V0.4 - November 2017 
           // NEW FEATURE : Power on/off heating zones with scheduled TOP start/stop
           // Add Hot Water Tank to the heaters/zones list and redesign zone 10 as zone "Entr�e/Cuisine" and zone 20 as zone "Salle A Manger" only
           // Dz zones : O Off, 10 Entr�e/Cuisine, 20 Salle A Manger, 30	Salon, 40	RDC, 50	CH4, 60	CH3, 70	CH2, 80	Sdb, 90	Parental, 100	1ER
// V0.2/V0.3 - October 2017 
           // NEW FEATURE : Heating Zones feature - Each heater belongs to one or two heating zones. 
           // NEW FEATURE : Monitor netwok sensors/actuators like ESP8266 by checking in MQTT domoticz/in topic reception of Lastwill messages
           // Lastwill messages are like {"command" : "addlogmessage", "message" : "Heater went Offline - mac_6@IP : 3B1D5F@192.168.1.25"} 
           // If failure, raise Alert in Dz ("Panne Domotique" - idxFailureFlag Dz device)
           // NEW FEATURE : For all heaters, based on ACS712 raw data, compute heaters characteristics : Min/Max/Average heater usage at Power On and Power off 
// V0.1 - July 2017 

const VERBOSE = false; // Detailed logging or not 
if( process.argv[ 2 ] === 'RASPBERRY')                                                         // Unless otherwise specified 
      MyJSecretKeys  = require('/home/pi/iot_domoticz/WiFi_DZ_MQTT_SecretKeys.js');            
else  MyJSecretKeys  = require('/volume1/@appstore/iot_domoticz/WiFi_DZ_MQTT_SecretKeys.js');  // execution hardware assumed to be Synology
const crypto         = require('crypto');  

// ** Monitoring attributes **
const HOTWATERTANK_OFFLINE = "HotWaterTank went Offline";
const HEATER_OFFLINE       = "Heater went Offline";
const LIGHTING_ONLINE      = "Lighting Online";
const LIGHTING_OFFLINE     = "Lighting went Offline";
const ALARM_ONLINE         = "ALARM Server ON LINE";
const ALARM_OFFLINE        = "ALARM Server went OFF LINE";
const FIREALARM_ONLINE     = "FIREalarm Online";
const FIREALARM_OFFLINE    = "FIREalarm went Offline";
const VTH_SECPANEL_ONLINE  = "VTH SECPANEL ON LINE"
const VTH_SECPANEL_OFFLINE = "VTH SECPANEL went OFF LINE"
const VTH_BOX_ONLINE       = "VTH BOX ON LINE"
const VTH_BOX_OFFLINE      = "VTH BOX went OFF LINE"

var   myLighting       = 0;  // Lighting status,      0=OK, 1=Failed less than 1 hour ago, 2=Failed more than 1 hour ago (i.e alert to raise), 3=Alert already raised 
var   myAlarmSvr       = 0;  // Alarm server status,  0=OK, 1=Failed less than 1 hour ago, 2=Failed more than 1 hour ago (i.e alert to raise), 3=Alert already raised 
var   myFireAlarmSvr   = 0;  // Fire Alarm server status,  0=OK, 1=Failed less than 1 hour ago, 2=Failed more than 1 hour ago (i.e alert to raise), 3=Alert already raised 
var   myVTHsecpanel    = 0;  // VTH Secpanel, 0=OK, 1=Failed less than 1 hour ago, 2=Failed more than 1 hour ago (i.e alert to raise), 3=Alert already raised 
var   myVTHbox         = 0;  // VTH Box, 0=OK, 1=Failed less than 1 hour ago, 2=Failed more than 1 hour ago (i.e alert to raise), 3=Alert already raised 
const HeatingTimer     = 60; // Send heating command to Heaters and Log latest heaters characteristics computed every n minutes

// ** Domoticz Parameters and communication functions **
var http_Domoticz = require('http');
var JSON_API     = {
host: 'localhost',        
port: MyJSecretKeys.DZ_PORT,
path: '/'
};

const JSECPANEL_DISARM           = 0;  // JSON SecPanel AlarmEnable
const JSECPANEL_ARM_HOME         = 1;
const JSECPANEL_ARM_AWAY         = 2;
const MSECPANEL_DISARM           = 0;  // MQTT SecPanel AlarmEnable
const MSECPANEL_ARM_HOME         = 11;
const MSECPANEL_ARM_AWAY         = 9;
              
const idxFailureFlag            = MyJSecretKeys.idxClusterFailureFlag;      // Dz "Panne Domotique" device
const idxAlarmFailureFlag       = MyJSecretKeys.idx_AlarmFailureFlag;       // Dz "Panne Alarme" Device 
const idxUnactiveHeatersDisplay = MyJSecretKeys.idx_UnactiveHeatersDisplay; // Dz "Zones Chauffage Actives" Device
const idxActivateHeaters        = MyJSecretKeys.idx_ActivateHeaters;        // Dz "Horaires/Start Chauffage" Device
const idxUnactivateHeaters      = MyJSecretKeys.idx_UnactivateHeaters;      // Dz "Horaires/Stop Chauffage" Device
const Var_UnactiveHeaters       = MyJSecretKeys.Var_UnactiveHeaters;        // Dz user variable# to store the heaters heating state command
const Varname_UnactiveHeaters   = MyJSecretKeys.Varname_UnactiveHeaters;    // Dz user variable name to store the heaters heating state command

var DomoticzJsonTalk = function( JsonUrl, callBack, objectToCompute ) {    
   var savedURL         = JSON.stringify(JsonUrl);                     
   var _JsonUrl         = JSON.parse(savedURL);      // Function scope to capture values of JsonUrl and objectToCompute next line 
   var _objectToCompute = "";
   if( objectToCompute ) _objectToCompute = JSON.parse(JSON.stringify(objectToCompute));
   if( VERBOSE ) console.log("\n** DomoticZ URL request=" + savedURL );
   http_Domoticz.get(_JsonUrl, function(resp){
      var HttpAnswer = "";
      resp.on('data', function(ReturnData){ 
            HttpAnswer += ReturnData;
      });
      resp.on('end', function(ReturnData){ 
         if( VERBOSE ) console.log("\nDomoticZ answer=" + HttpAnswer);
         try { // To avoid crash if Domoticz returns a non JSON answer like <html><head><title>Unauthorized</title></head><body><h1>401 Unauthorized</h1></body></html>
               if( callBack ) callBack( null, JSON.parse(HttpAnswer), _objectToCompute );
         } catch (err) {
               if( VERBOSE ) console.log("\n** Error - " + err.message + "\nError to parse DomoticZ answer to request URL:" + savedURL );
               callBack( err, null, _objectToCompute );
         }  // try { // To avoid crash if D       
      });
   }).on("error", function(e){
         if( VERBOSE ) console.log("\n** Error - " + e.message + "\nCan't reach DomoticZ with URL:" + savedURL );
         if( callBack ) callBack( e, null, _objectToCompute );
   });
};   // function DomoticzJsonTalk( JsonUrl )

var signedAlarmRequest = function( error, SecPanel, alarmToken ) {
  if( error ) return;
  if( (SecPanel.secstatus === JSECPANEL_DISARM   && alarmToken.nvalue != MSECPANEL_DISARM)     || 
      (SecPanel.secstatus === JSECPANEL_ARM_HOME && alarmToken.nvalue != MSECPANEL_ARM_HOME)   || 
      (SecPanel.secstatus === JSECPANEL_ARM_AWAY && alarmToken.nvalue != MSECPANEL_ARM_AWAY) ) {
          console.log("\n*** " + new Date() + " SECURITY WARNING - INCORRECT Secpanel state in message received" );       
  } else {     
          var cdatetime     = new Date();
          cdatetime.setHours( cdatetime.getHours() - cdatetime.getTimezoneOffset()/60 );
          var Nonce =  {  
               "stationID" : MyJSecretKeys.DZ_ALARM_CID,
               "datetime"  : cdatetime.toISOString().replace(/Z/, '000').replace(/T/, ' '),
               "nvalue"    : alarmToken.nvalue
          };
          alarmToken.description = Nonce;
          alarmToken.idx         = MyJSecretKeys.idx_SecPanel;
          alarmToken.RSSI        = crypto.createHash('md5').update(JSON.stringify(alarmToken.description)+MyJSecretKeys.SecPanel_Seccode).digest('hex');
          console.log("\n*** " + new Date() + " MQTT MD5 signed message about Alarm Request sent: " + JSON.stringify(alarmToken) );
          client.publish( 'domoticz/out', JSON.stringify(alarmToken) ); // Inform Alarm server and other Alarm clients 
  } // if( data.secstatus === objectToCompute ) {
}; // var signedAlarmRequest = fu

var updateSecPanel = function( error, SecPanel, alarmToken ) {
  if( error ) return;
  if( (SecPanel.secstatus === JSECPANEL_DISARM   && alarmToken.nvalue != MSECPANEL_DISARM)     || 
      (SecPanel.secstatus === JSECPANEL_ARM_HOME && alarmToken.nvalue != MSECPANEL_ARM_HOME)   || 
      (SecPanel.secstatus === JSECPANEL_ARM_AWAY && alarmToken.nvalue != MSECPANEL_ARM_AWAY) ) {
          if( alarmToken.nvalue === MSECPANEL_ARM_HOME ) JSON_API.path = '/json.htm?type=command&param=setsecstatus&secstatus=' + JSECPANEL_ARM_HOME + '&seccode=' + MyJSecretKeys.SecPanel_Seccode; 
          if( alarmToken.nvalue === MSECPANEL_ARM_AWAY ) JSON_API.path = '/json.htm?type=command&param=setsecstatus&secstatus=' + JSECPANEL_ARM_AWAY + '&seccode=' + MyJSecretKeys.SecPanel_Seccode; 
          if( alarmToken.nvalue === MSECPANEL_DISARM )   JSON_API.path = '/json.htm?type=command&param=setsecstatus&secstatus=' + JSECPANEL_DISARM   + '&seccode=' + MyJSecretKeys.SecPanel_Seccode;
          DomoticzJsonTalk( JSON_API );        
  } // if( (SecPanel.secstatus === JSECPANEL_DISARM   && alarmT
}; // var updateSecPanel = funct

var RaisefailureFlag = function( error, data, objectToCompute ) {
  if( error ) return;
  if( data.result[0].Status === "Off" ) {
       JSON_API.path = '/json.htm?type=command&param=switchlight&idx=' + objectToCompute + '&switchcmd=On&passcode=' + MyJSecretKeys.ProtectedDevicePassword;
       JSON_API.path = JSON_API.path.replace(/ /g,"");
       DomoticzJsonTalk( JSON_API );                
  }  // if( GetAlarmIDX.result[0].Status === 
}; // var RaisefailureFlag = fu

var GetHeatersStatus = function( error, data, Hstatus ) {   // Get from Dz the latest heating command saved
  if( error ) return;
  HeatingStatus = JSON.parse( Hstatus=data.result[0].Value ); 
  if( VERBOSE ) console.log("Heaters Status stored in DomoticZ is ", HeatingStatus ); 
  if( HeatingStatus != null && HeatingStatus != "" && HeatingStatus != "UNKNOWN" )
    myHeaters.forEach( function( value ) { 
       if( VERBOSE ) console.log("Heater " + value.HeaterName + " : "  + HeatingStatus[(""+value.IDX)] ); 
       if(value.IDX != -1) value.Active = HeatingStatus[(""+value.IDX)];
    });
  myHeaters.forEach( function( value ) { 
        if(value.IDX != -1) HeatingStatusTxt = HeatingStatusTxt + value.HeaterName + ":" + value.Active + " "; 
  });  
  HeatingStatus = ""+Hstatus; // CAST HeatingStatus to string (required for MQTT publish)
  JSON_API.path = '/json.htm?type=command&param=udevice&idx=' + idxUnactiveHeatersDisplay + '&nvalue=0&svalue=' + HeatingStatusTxt;
  JSON_API.path = JSON_API.path.replace(/ /g,"%20");
  DomoticzJsonTalk( JSON_API );
}; // var GetHeatingStatus = function( error, dat

// ** Heater Class Template and heater Objects
var   HeatingStatus    = ""; // GLOBAL HOUSE HEATERS HEATING STATE COMMAND - Include an attribute for every heater to set its heating state (i.e. Power On or Off) 
var   HeatingStatusTxt = ""; // The same Heating state data casted to text format to display at DomoticZ side 
function heater( MacAddress, IDX, Nominal, HeaterName, Zone1, Zone2 ) {
    this.MacAddress=MacAddress; this.HeaterName=HeaterName; this.IDX = IDX; this.Nominal = Nominal; this.Active = "On"; this.DeviceFault = 0; 
    this.Zone1 = Zone1; this.Zone2 = Zone2;    
    this.NumberOf_OFFRead = 0; this.OFF_VadcMin = 1024; this.OFF_VadcMax = 0; this.OFF_PowerAverage = 0; this.OFF_PowerMin = Nominal;     this.OFF_PowerMax = 0;
    this.NumberOf_ONRead = 0;  this.ON_VadcMin  = 1024; this.ON_VadcMax  = 0; this.ON_PowerAverage  = 0; this.ON_PowerMin  = 2 * Nominal; this.ON_PowerMax  = 0;
    this.RaiseFaultFlag = function() {                
           this.DeviceFault = 1;  // 0=OK, 1=Failed less than 1 hour ago, 2=Failed more than 1 hour ago (i.e alert to raise), 3=Alert already raised
           JSON_API.path = '/json.htm?type=devices&rid=' + this.IDX; // Reset Power for this heater
           DomoticzJsonTalk( JSON_API, function(error, data, idx ) {   
                    if( error ) return;
                    var Meter = data.result[0].Data.split(";"); 		
                    if( VERBOSE ) console.log("Heater: " + data.result[0].Name + " - Usage1/Usage2//Power (Wh/Wh//W)=" + Meter[0] + "/" + Meter[1] + "//" + Meter[4] );
                    JSON_API.path = '/json.htm?type=command&param=udevice&idx=' +  idx + '&nvalue=0&svalue=' + Meter[0] + ';' + Meter[1] + ';0;0;0;0';
                    DomoticzJsonTalk( JSON_API );      
           }, this.IDX ); // DomoticzJsonTalk( JSON_API, function(e
    }  // this.RaiseFaultFlag = function(
    this.log = function(Vadc_Min, Vadc_Max) {
           this.DeviceFault = 0;  // Reset the error flag, we received a message from this heater 
           var HeaterPower = parseInt( 230 * ( ( 4.3 * 0.707 * ( (Vadc_Max - Vadc_Min) / 2 ) / 1024  ) / 0.100 ) );
           if( VERBOSE ) console.log("Heater Power ADC-ACS712 reading = " + HeaterPower + " Watts");
           if( HeaterPower >= this.Nominal/2 )  {
                this.ON_PowerAverage = (this.ON_PowerAverage * this.NumberOf_ONRead++ + HeaterPower)/this.NumberOf_ONRead;
                if( Vadc_Max > this.ON_VadcMax )      this.ON_VadcMax  = Vadc_Max;
                if( Vadc_Min < this.ON_VadcMin )      this.ON_VadcMin  = Vadc_Min;
                if( HeaterPower > this.ON_PowerMax )  this.ON_PowerMax = HeaterPower;
                if( HeaterPower < this.ON_PowerMin )  this.ON_PowerMin = HeaterPower;
           } else {
                this.OFF_PowerAverage = (this.OFF_PowerAverage * this.NumberOf_OFFRead++ + HeaterPower)/this.NumberOf_OFFRead;
                if( Vadc_Max > this.OFF_VadcMax )     this.OFF_VadcMax  = Vadc_Max;
                if( Vadc_Min < this.OFF_VadcMin )     this.OFF_VadcMin  = Vadc_Min;
                if( HeaterPower > this.OFF_PowerMax ) this.OFF_PowerMax = HeaterPower;
                if( HeaterPower < this.OFF_PowerMin ) this.OFF_PowerMin = HeaterPower;
           }
    } // heater.log method
}   // function heater( IDX
var   myHeaters        = [ new heater("3A73F0", 28, 1426, "ENTREE", "10", "40" ),     new heater("3B2071", 29, 1384, "CUISINE", "10", "40"),     new heater("3B1D5F", 27, 1426, "SALLE A MANGER", "20", "40"),
                           new heater("FA9ECE", 30, 1261, "SALON SUD", "30", "40"),   new heater("3B1A D", 31, 1261, "SALON NORD", "30", "40"),
                           new heater("94D6A3", 35, 1239, "CH4", "50", "100"),        new heater("94CD66", 36, 909,  "CH3", "60", "100" ),       new heater("94CDC2", 37, 1422, "CH2", "70", "100"), 
                           new heater("9497B1", -1, 500,  "SDB", "80", "100"),        new heater("65DEF6", 38, 1442, "PARENTAL", "90", "100"),   new heater("412A10", 34, 1603, "ECS", "-1", "-1") ];
                           
// *************** MAIN START HERE ***************
if( process.argv[ 2 ] === 'RASPBERRY') console.log("*** " + new Date() + " - Domoticz iot_Orchestrator v1.10 starting - Server platform set to RASPBERRY ***\n");
else console.log("*** " + new Date() + " - Domoticz iot_Orchestrator v1.10 starting - Server platform set to SYNOLOGY ***\n");

// Get from Dz the latest heating command saved and display it 
JSON_API.path = '/json.htm?type=command&param=getuservariable&idx=' + Var_UnactiveHeaters;
JSON_API.path = JSON_API.path.replace(/ /g,"%20");
DomoticzJsonTalk( JSON_API, GetHeatersStatus, HeatingStatus );
// Set the two Heating Zones Scheduled TOP Start/Stop selector switches to [Ack]
JSON_API.path = '/json.htm?type=command&param=switchlight&idx=' + idxActivateHeaters   + '&switchcmd=Set%20Level&level=110';
DomoticzJsonTalk( JSON_API );
JSON_API.path = '/json.htm?type=command&param=switchlight&idx=' + idxUnactivateHeaters + '&switchcmd=Set%20Level&level=110';
DomoticzJsonTalk( JSON_API );

// Every n minutes, DO the following :
// - send to heaters the heaters heating state command, log this heating command and the heaters characteristics 
// - check if a heater, Lighting or Alarm went offline more than 1 hour ago, if yes raise the corresponding dz Failure Alert flag 
setInterval(function(){ 
    var heaterFailure = false;  // false=No heater has failed, true=One heater at least has failed. This flag is to avoid a flood of sms/email alerts because all heaters were shut off or all lost MQTT 
    
    // Send to heaters and log/display the latest heating state command
    if( VERBOSE ) console.log("\n*** " + new Date() + " - HEATERS CHARACTERISTICS UPDATE:");
    if( VERBOSE ) myHeaters.forEach( function( value ) { console.log(value) } );
    if( VERBOSE ) console.log("\n*** " + new Date() + " - HEATERS HEATING STATE:");
    if( VERBOSE ) console.log(HeatingStatus);  // Log the heating state
    client.publish('heating/out', HeatingStatus);   // Send the heating state command to all the heaters
    JSON_API.path = '/json.htm?type=command&param=udevice&idx=' + idxUnactiveHeatersDisplay + '&nvalue=0&svalue=' + HeatingStatusTxt;   // Dispay it at Dz side
    JSON_API.path = JSON_API.path.replace(/ /g,"%20");
    DomoticzJsonTalk( JSON_API );
    
    // Set the two Heating Zones Scheduled TOP Start/Stop selector switches to [Ack]
    JSON_API.path = '/json.htm?type=command&param=switchlight&idx=' + idxActivateHeaters   + '&switchcmd=Set%20Level&level=110';
    DomoticzJsonTalk( JSON_API );
    JSON_API.path = '/json.htm?type=command&param=switchlight&idx=' + idxUnactivateHeaters + '&switchcmd=Set%20Level&level=110';
    DomoticzJsonTalk( JSON_API );
    
    // Now check sensors/actuators are OK. If a Heater, Lighting or Alarm went offline more than one hour ago, raise DomoticZ Failure Alert flag 
    if( myLighting === 1 ) myLighting = 2;
    else if( myLighting === 2 ) {
            JSON_API.path = '/json.htm?type=devices&rid=' + idxFailureFlag;
            DomoticzJsonTalk( JSON_API, RaisefailureFlag, idxFailureFlag );
            myLighting = 3; 
         }  // if( myLighting === 2 ) {    
    if( myAlarmSvr === 1 ) myAlarmSvr = 2;
    else if( myAlarmSvr === 2 ) {
            JSON_API.path = '/json.htm?type=devices&rid=' + idxAlarmFailureFlag;
            DomoticzJsonTalk( JSON_API, RaisefailureFlag, idxAlarmFailureFlag );
            myAlarmSvr = 3; 
         }  // if( myAlarmSvr === 2 ) {
    if( myFireAlarmSvr === 1 ) myFireAlarmSvr = 2;
    else if( myFireAlarmSvr === 2 ) {
            JSON_API.path = '/json.htm?type=devices&rid=' + idxAlarmFailureFlag;
            DomoticzJsonTalk( JSON_API, RaisefailureFlag, idxAlarmFailureFlag );
            myFireAlarmSvr = 3; 
         }  // if( myFireAlarmSvr === 2 ) {     
    if( myVTHsecpanel === 1 ) myVTHsecpanel = 2;
    else if( myVTHsecpanel === 2 ) {
            JSON_API.path = '/json.htm?type=devices&rid=' + idxAlarmFailureFlag;
            DomoticzJsonTalk( JSON_API, RaisefailureFlag, idxAlarmFailureFlag );
            myVTHsecpanel = 3; 
         }  // if( myVTHsecpanel === 2 ) {  
    if( myVTHbox === 1 ) myVTHbox = 2;
    else if( myVTHbox === 2 ) {
            JSON_API.path = '/json.htm?type=devices&rid=' + idxAlarmFailureFlag;
            DomoticzJsonTalk( JSON_API, RaisefailureFlag, idxAlarmFailureFlag );
            myVTHbox = 3; 
         }  // if( myVTHbox === 2 ) {  
    myHeaters.forEach(function( value ) {
       if( value.DeviceFault === 1 ) value.DeviceFault = 2;
       else if( value.DeviceFault === 2 ) {
               heaterFailure = true;
               value.DeviceFault = 3; 
            } // if( value.DeviceFault === 2 ) {
    }); // myHeaters.forEach(function( value ) {
    if( heaterFailure ) {  
        JSON_API.path = '/json.htm?type=devices&rid=' + idxFailureFlag;
        DomoticzJsonTalk( JSON_API, RaisefailureFlag, idxFailureFlag );
    } // if( heaterFailure ) {
}, HeatingTimer*60000);

// Start MQTT and then manage events
var mqtt = require('mqtt');
var client  = mqtt.connect('mqtt://localhost');    //  //[$$MQTT_PARAMETER]

client.on('connect', function () {
  client.subscribe(['domoticz/in', 'domoticz/out', 'heating/in']);
})  // client.on('co

client.on('message', function (topic, message) {
     var hzoneModified = false;  // If at least One Heating Zone was changed at DomoticZ side (i.e a TOP start or TOP Stop heating command for this zone) 
     var JSONmessage=JSON.parse(message);
     message=message.toString() // message is Buffer 
     if( VERBOSE ) console.log("\n*** " + new Date() + " New MQTT message received: " + message);
    
     // Secpanel MD5 signed message
     if(topic === 'domoticz/out' && JSONmessage.idx === MyJSecretKeys.DZ_idx_SecPanel) {  // message coming from local Domoticz secpanel. Send a signed request if verified
          if( !VERBOSE ) console.log("\n*** " + new Date() + " New MQTT message about local Secpanel received: " + message);
          JSON_API.path = '/json.htm?type=command&param=getsecstatus'
          JSON_API.path = JSON_API.path.replace(/ /g,"");
          DomoticzJsonTalk( JSON_API, signedAlarmRequest, JSONmessage );            
     }  // if(topic === 'domoticz/out' && JSONmessage.idx =
     
     if(topic === 'domoticz/out' && JSONmessage.idx === MyJSecretKeys.idx_SecPanel) {     // message coming from another alarm client. Synchronize local Dz Secpanel
          if( (JSONmessage.RSSI != crypto.createHash('md5').update(JSON.stringify(JSONmessage.description)+MyJSecretKeys.SecPanel_Seccode).digest('hex')) ||  ( ( (new Date() - new Date( JSONmessage.description.datetime )) / 1000 ) > 2 )  )
              console.log("\n*** " + new Date() + " SECURITY WARNING - Message with invalid MD5 hash or datetime stamp received" );
          else if( JSONmessage.description.stationID != MyJSecretKeys.DZ_ALARM_CID) {
              if( !VERBOSE ) console.log("\n*** " + new Date() + " MQTT MD5 signed message about Alarm Request received: " + message);
              JSON_API.path = '/json.htm?type=command&param=getsecstatus'
              JSON_API.path = JSON_API.path.replace(/ /g,"");
              DomoticzJsonTalk( JSON_API, updateSecPanel, JSONmessage );              
          } // else if( JSONmessage.description.stationID != MyJS
     } // if(topic === 'domoticz/out' && JSONmessage.idx ===) {    
     
     // *** Heating Zone TOP start or Stop command message comming from DomoticZ
     if( message.indexOf('"name" : "Horaires/Stop Chauffage"') != -1 ) {    // we received a TOP stop for a zone
          hzoneModified = true;
          var UnactivatedZone =  JSONmessage.svalue1;
          if( UnactivatedZone === "0" ) { 
              if( VERBOSE ) console.log("Schedule Reset - Power UP all house Heaters "); 
              myHeaters.forEach( function( value ) { value.Active="On" } );
          } else {     
              if( VERBOSE ) console.log("Power DOWN the Heaters belonging to ZONE " + UnactivatedZone);   
              myHeaters.forEach( function( value ) { if(value.Zone1 === UnactivatedZone || value.Zone2 === UnactivatedZone )  value.Active="Off" } );  // Power Off the heaters belonging to this zone  
          }            
     } // if( message.indexOf('"name" : "Horaires/Stop Chauffage"') != -1 ) { 
     if( message.indexOf('"name" : "Horaires/Start Chauffage"') != -1 ) { // we received a TOP start for a zone
          hzoneModified = true;
          var ActivatedZone =  JSONmessage.svalue1;
          if( ActivatedZone === "0" ) { 
              if( VERBOSE ) console.log("Schedule Reset - Power UP all house Heaters"); 
              myHeaters.forEach( function( value ) { value.Active="On" } );
          } else {     
              if( VERBOSE ) console.log("Power UP the Heaters belonging to ZONE " + ActivatedZone);   
              myHeaters.forEach( function( value ) { if(value.Zone1 === ActivatedZone || value.Zone2 === ActivatedZone )  value.Active="On" } );  // Power On the heaters belonging to this zone   
          }            
     } // if( message.indexOf('"name" : "Horaires/Start Chauffage"') != -1 )  
     
     // Compute the new heating command, save it in Dz and send it to all the heaters
     if( hzoneModified ) { 
          HeatingStatus='{"command" : "activateheaters"';   HeatingStatusTxt="";   
          myHeaters.forEach( function( value ) { 
                    if(value.IDX != -1) { 
                         HeatingStatus    = HeatingStatus + ', "' + value.IDX + '" : "' + value.Active + '"'; 
                         HeatingStatusTxt = HeatingStatusTxt + value.HeaterName + ":" + value.Active + " "; 
                    }
          });
          HeatingStatus += "}";
          client.publish('heating/out', HeatingStatus); // Send now to all the heaters this heating command
          if( VERBOSE ) console.log("Published: "  + HeatingStatus);
          // Save the heating command in a Domoticz user variable
          JSON_API.path = '/json.htm?type=command&param=updateuservariable&vname=' + Varname_UnactiveHeaters + '&vtype=2&vvalue=' + HeatingStatus;
          JSON_API.path = JSON_API.path.replace(/ /g,"%20");
          DomoticzJsonTalk( JSON_API );
          // And last update the display of this heating command at Dz side
          JSON_API.path = '/json.htm?type=command&param=udevice&idx=' + idxUnactiveHeatersDisplay + '&nvalue=0&svalue=' + HeatingStatusTxt;
          JSON_API.path = JSON_API.path.replace(/ /g,"%20");
          DomoticzJsonTalk( JSON_API );
     }  // if( hzoneModified ) { 
     
     // *** Message coming from Heater/ACS712, VTH, Lighting or Alarm-Svr 
     if( message.indexOf("addlogmessage") != -1 ) { 
        // ligthing message
        if( VERBOSE ) console.log("Checking for LIGHTING event...");
        var pos = message.indexOf(LIGHTING_OFFLINE);
        if( pos != -1 )  { // Raise alert, MQTT said LIGHTING is dead !
            console.log("\n*** " + new Date() + " == LIGHTING FAILURE ==");
            console.log( message + "\n");
            myLighting = 1;
        }  // if( pos != -1 )  
        pos = message.indexOf(LIGHTING_ONLINE);
        if( pos != -1 )  { // Reset alert, LIGHTING is back !
            console.log("\n*** " + new Date() + " == LIGHTING ONLINE ==");
            console.log( message + "\n");
            myLighting = 0;
        } // if( pos != -1 )  
        // alarm-svr message
        if( VERBOSE ) console.log("Checking for ALARM-SVR event...");
        var pos = message.indexOf(ALARM_OFFLINE);
        if( pos != -1 )  { // Raise alert, MQTT said ALARM-SVR is dead !
            console.log("\n*** " + new Date() + " == ALARM-SVR FAILURE ==");
            console.log( message + "\n");
            myAlarmSvr = 1;
        } // if( pos != -1 )  
        pos = message.indexOf(ALARM_ONLINE);
        if( pos != -1 )  { // Reset alert, ALARM-SVR is back !
            console.log("\n*** " + new Date() + " == ALARM-SVR ONLINE ==");
            console.log( message + "\n");
            myAlarmSvr = 0;
        } // if( pos != -1 )  
        // Fire alarm-svr message
        if( VERBOSE ) console.log("Checking for FIRE ALARM-SVR event...");
        var pos = message.indexOf(FIREALARM_OFFLINE);
        if( pos != -1 )  { // Raise alert, MQTT said FIRE ALARM-SVR is dead !
            console.log("\n*** " + new Date() + " == FIRE ALARM-SVR FAILURE ==");
            console.log( message + "\n");
            myFireAlarmSvr = 1;
        } // if( pos != -1 )  
        pos = message.indexOf(FIREALARM_ONLINE);
        if( pos != -1 )  { // Reset alert, FIRE ALARM-SVR is back !
            console.log("\n*** " + new Date() + " == FIRE ALARM-SVR ONLINE ==");
            console.log( message + "\n");
            myFireAlarmSvr = 0;
        } // if( pos != -1 )
        // VTH message
        if( VERBOSE ) console.log("Checking for VTH event...");
        var pos = message.indexOf(VTH_SECPANEL_OFFLINE);
        if( pos != -1 )  { // Raise alert, MQTT said VTH_SECPANEL is dead !
            console.log("\n*** " + new Date() + " == VTH SECPANEL FAILURE ==");
            console.log( message + "\n");
            myVTHsecpanel = 1;
        } // if( pos != -1 )  
        pos = message.indexOf(VTH_SECPANEL_ONLINE);
        if( pos != -1 )  { // Reset alert, VTH_SECPANEL is back !
            console.log("\n*** " + new Date() + " == VTH SECPANEL ONLINE ==");
            console.log( message + "\n");
            myVTHsecpanel = 0;
        } // if( pos != -1 )
        var pos = message.indexOf(VTH_BOX_OFFLINE);
        if( pos != -1 )  { // Raise alert, MQTT said VTH_BOX is dead !
            console.log("\n*** " + new Date() + " == VTH BOX FAILURE ==");
            console.log( message + "\n");
            myVTHbox = 1;
        } // if( pos != -1 )  
        pos = message.indexOf(VTH_BOX_ONLINE);
        if( pos != -1 )  { // Reset alert, VTH_BOX is back !
            console.log("\n*** " + new Date() + " == VTH BOX ONLINE ==");
            console.log( message + "\n");
            myVTHbox = 0;
        } // if( pos != -1 )
        // heater message        
        if( VERBOSE ) console.log("Checking for Heater event...");
        var pos = message.indexOf(HEATER_OFFLINE);
        if( pos === -1 ) pos = message.indexOf(HOTWATERTANK_OFFLINE);    
        if( pos != -1 )  { // Raise alert, MQTT said a heater is dead !
            pos = message.indexOf("@192");
            var mac6 = message.slice(pos-6,pos);
            myHeaters.forEach(function( value ) {
                  if( value.MacAddress === mac6 ) {
                      console.log("\n*** " + new Date() + " == HEATER FAILURE: ID/IDX/MAC=" + value.HeaterName + "/" + value.IDX + "/" + value.MacAddress + " ==");
                      value.RaiseFaultFlag();
                  } // if( value.MacAddress === mac6 ) {   
            }); // myHeaters.forEach(function( value ) {      
        } else { // Non heater failure message
            var IDXsmsg;
            myHeaters.forEach(function( value ) {
                  IDXsmsg="idx : "+ value.IDX;
                  pos = message.indexOf(IDXsmsg);
                  if( VERBOSE ) console.log("Checking for Heater usage ACS712 message...Trying " + IDXsmsg + ", posResult = " + pos);
                  if( pos != -1 ) {
                       pos = message.indexOf("Vadc_Min/Max=")
                       var posSlash = message.indexOf("/",pos+12)
                       var posQMark = message.indexOf('"',posSlash)
                       var Vadc_Min = message.slice(pos+13,posSlash);
                       var Vadc_Max = message.slice(posSlash+1,posQMark);
                       if( VERBOSE ) console.log("Heater usage ACS712 message, IDX/Vadc_Min/Max = " +  value.IDX + "/" + Vadc_Min + "/" + Vadc_Max );
                       value.log(Vadc_Min, Vadc_Max);                   
                  }  // if( pos != -1 ) {
            }); // myHeaters.forEach(function(
        }  // else if( pos != -1 )  { // Raise alarm, MQTT said this one is dead !    
     } //  if( message.indexOf("addlogmessage") != -1 ) { // Message coming from heater/ACS712 about its power consumption
     
}) // client.on('message', functio

