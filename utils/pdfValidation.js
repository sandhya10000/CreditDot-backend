const fs = require("fs");

const isValidPdf = (filePath) => {
  let fd;

  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(5);
    const bytesRead = fs.readSync(fd, header, 0, 5, 0);

    return bytesRead === 5 && header.toString("ascii") === "%PDF-";
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
};

module.exports = { isValidPdf };
