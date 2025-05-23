const fs = require('fs');
const path = require('path');

module.exports = (directory, foldersOnly = false, filesOnly = false, flatten = true, nested = false) => {
    let fileNames = [];

    // Read the directory contents
    const files = fs.readdirSync(directory, { withFileTypes: true });

    // Loop through each file/folder
    for (const file of files) {
        const filePath = path.join(directory, file.name);

        // If it's a directory and foldersOnly is true, skip files
        if (file.isDirectory()) {
            if (foldersOnly) {
                fileNames.push(filePath);
            }
            // Always recurse into directories, but only add files if filesOnly is not set
            const nestedFiles = module.exports(filePath, foldersOnly, filesOnly, flatten, nested);
            if (nested) {
                fileNames.push(...nestedFiles); // Flatten the nested result
            } else {
                fileNames = fileNames.concat(nestedFiles);
            }
        } else if (file.isFile()) {
            // If filesOnly is true, only push files
            if (filesOnly) {
                fileNames.push(filePath);
            } else if (!foldersOnly) {
                // If neither foldersOnly nor filesOnly is set, push files
                fileNames.push(filePath);
            }
        }
    }

    // Return files as a flat array if flatten is true, otherwise return as it is
    return flatten ? fileNames.flat() : fileNames;
};
