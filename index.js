const Kisi =  require("./kisi-client.js")
const AWS = require('aws-sdk');
const { async } = require("regenerator-runtime");
AWS.config.update({ region: 'us-east-1' });


require("regenerator-runtime");
require("dotenv").config()

class KisiResponse  {  // class to hold response value
    constructor(value) {
        this.value = value;
      }
}

const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
const encrypted = process.env['KISI_API'];
const kisiClient = new Kisi()
let decrypted;

async function processEvent(event,context,callback) {

    // filtering for unlock event
    if ((event.action.trim() == "unlock") && event.success == true) {
        var kisiReponse =  new KisiResponse();

        // functions required for anti-passback
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
            console.log("Share deleted!")
        }

        async function getGroupIdFromCorrespondingDoor(lock_id) {       //gets group id from the opposite door id 
            console.log("getting group id from corresponding lock")
            await kisiClient.get(`locks/${lock_id}`)
                .then(async function(lock){kisiReponse.value = await lock.name; })
                .catch(error => console.log(error))
             kisiReponse.value = kisiReponse.value.includes("Enter_Office") ? kisiReponse.value.replace("Enter_Office", "Leave_Office") : kisiReponse.value.replace("Leave_Office", "Enter_Office")
             const groupParam = {
                 query : kisiReponse.value
             }
             await kisiClient.get("groups", groupParam)
             .then(async function(groups) { kisiReponse.value = await groups.data[0].id})
             .catch(error => console.log(error))
             console.log("group_id obtained is " + kisiReponse.value)
             return kisiReponse.value
        }

        // checks if door is an out door
        async function isDoorOut(lockId) {
            console.log("Checking if the look is door out")
            await kisiClient.get(`locks/${lockId}`)
            .then(async function(lock) { kisiReponse.value =  lock.name} ) 
            .catch(error => console.log(error))
            return kisiReponse.value.includes("Leave_Office");
        }

        async function unlockDoor(lock_id) {
            console.log("unlocking door")
            await kisiClient.post(`locks/${lock_id}/unlock`)
            .then(unlock_message => console.log(unlock_message))
            .catch(error => console.log(error))
            console.log("Door Unlocked")
        }    

        async function getCorrespondingLockIdFromLock(lockId) {
            console.log("Obtaining lock id from the corresponding lock id");
            await kisiClient.get(`locks/${lockId}`)
                .then(async function(lock){kisiReponse.value = await lock.name; })
                .catch(error => console.log(error));
             kisiReponse.value = await kisiReponse.value.includes("Enter_Office") ? kisiReponse.value.replace("Enter_Office", "Leave_Office") : kisiReponse.value.replace("Leave_Office", "Enter_Office");
             const lockParam = {
                 query : kisiReponse.value
             }
             await kisiClient.get("locks", lockParam)
             .then(async function (locks) { kisiReponse.value = await locks.data[0].id; })
             .catch(error => console.log(error))
             console.log("Lock id obtained is " + kisiReponse.value)
             return kisiReponse.value
        }

        if(await isDoorOut(event.object_id)) {
            await unlockDoor(await getCorrespondingLockIdFromLock(event.object_id))
            console.log("Door Out Unlocked!")
        }


        // Implementation of anti-passback 
        await kisiClient.get(`shares/${event.references[2].id}`)
            .then(async function(share) {
                console.log(share)
                if (share.role != 'administrator') {
                    await addUserToGroup(share.email.trim(), await getGroupIdFromCorrespondingDoor(event.object_id))
                    await removeUserFromGroup()
                }
                    
            })
            .catch(error => console.log(error))
        
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
