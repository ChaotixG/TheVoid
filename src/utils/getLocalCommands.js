const path = require('path');
const getAllFiles = require('./getAllFiles');

module.exports = (exceptions = []) => {
    let localCommands = [];
    // Get all files from the 'commands' directory, excluding folders
    const localCommandsFolders = getAllFiles(
        path.join(__dirname, '..', 'commands'), true, false
    );
        //console.log(localCommandsFolders)
    const localCommandFiles = getAllFiles(
        path.join(__dirname, '..', 'commands'), false, true,
    );
    for (const commandFile of localCommandFiles){
        const commandObject = require (commandFile);
        if( exceptions.includes(commandObject.name)){
            continue;
        }
        //console.log(commandFile)
        localCommands.push(commandObject)
    }
    //console.log(localCommandFiles)
    return localCommands;
};
