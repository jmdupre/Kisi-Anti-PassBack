const Kisi =  require("./kisi-client.js")
const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-1' });

require("regenerator-runtime");
require("dotenv").config()

const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
const encrypted = process.env['KISI_API'];
const kisiClient = new Kisi()

const In_Doors=[
 process.env.DOOR_IN,  process.env.TLC_DOOR_IN,process.env.ODC_T_DOOR_IN
]//  

const Out_Door_Dict ={
  process.env.DOOR_OUT : process.env.DOOR_IN,
  process.env.TLC_DOOR_OUT : process.env.TLC_DOOR_IN,
  process.env.ODC_T_DOOR_OUT : process.env.ODC_T_DOOR_IN
} //  outDoor maps to corresponding indoor 


const DOOR_GROUP={
  process.env.DOOR_IN : process.env.DOOR_OUT_GROUP,
  process.env.DOOR_OUT : process.env.DOOR_IN_GROUP,
  process.env.TLC_DOOR_IN : process.env.TLC_DOOR_0UT_GROUP,
  process.env.TLC_DOOR_OUT : process.env.TLC_DOOR_IN_GROUP,
  process.env.ODC_T_DOOR_OUT : process.env.ODC_T_DOOR_IN_GROUP,
  process.env.ODC_T_DOOR_IN : process.env.ODC_T_DOOR_OUT_GROUP
}//  Door maps to coresponding door_Out_Group and viceversa



let decrypted;

async function processEvent(event,context,callback) {

    // filtering for unlock event
    if ((event.action.trim() == "unlock") && event.success == true) {
            

        async function addUserToGroup(email, group_id) {  
            console.log('starting adding function')
            const share = {                    
                "user_id" : event.actor_id,
                "group_id" : group_id
            }
            await kisiClient
                .get("shares", share)
                .then(async function(shares) { 
                    console.log(shares)
                    if (!shares.data.length) {      // Checks if user already exist in the group
                        const share = {
                            "email" : email,
                            "group_id" : group_id
                        }
                        await kisiClient                          // add user to a group
                            .post("shares", share)
                            .then(share => console.log(share))
                            .catch(error => console.log(error))
                    }
                })
                .catch(error => console.log(error))
                
        }

        async function removeUserFromGroup() {        
            await kisiClient.delete(`shares/${event.references[2].id}`)     // deletes a user with a given share
            .then(share => console.log(share))
            .catch(error => console.log(error))
        
        }

        async function unlockDoor(lock_id) {
            await kisiClient.post(`locks/${lock_id}/unlock`)
            .then(unlock_message => console.log(unlock_message))
            .catch(error => console.log(error))
            
        }

        if (In_Doors.includes(event.object_id)) {
            await kisiClient.get(`shares/${event.references[2].id}`)
                .then(async function(share) {
                    console.log(share)
                    if (share.role != 'administrator') {
                        await addUserToGroup(share.email.trim(), DOOR_GROUP[event.object_id])
                        await removeUserFromGroup()
                    }
                })
                .catch(error => console.log(error))
                
        } else if(Out_Door_Dict.hasOwnProperty(event.object_id)) {

            await unlockDoor(Out_Door_Dict[event.object_id]) 

            await kisiClient.get(`shares/${event.references[2].id}`)
                .then(async function(share) {
                    console.log(share)                   
                    if (share.role != 'administrator') {
                        await addUserToGroup(share.email.trim(), DOOR_GROUP[event.object_id])
                        await removeUserFromGroup()
                    }
                })
                .catch(error => console.log(error))    
        }
    }
    callback(null, 'Ok')
}

exports.handler = async function(event, context, callback) {
    
    if (!decrypted) {
        const kms = new AWS.KMS();
        try {
            const req = {
                CiphertextBlob: Buffer.from(encrypted, 'base64'),
                EncryptionContext: { LambdaFunctionName: functionName },
            };
            const data = await kms.decrypt(req).promise();
            decrypted = data.Plaintext.toString('ascii');
            kisiClient.setLoginSecret(decrypted)
        } catch (err) {
            console.log('Decrypt error:', err);
            throw err;
        }
    }
    await processEvent(event,context, callback);
};

