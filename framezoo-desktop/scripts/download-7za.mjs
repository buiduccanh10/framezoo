import fs from 'fs';
import https from 'https';
import path from 'path';

const url = 'https://github.com/develar/7zip-bin/raw/master/win/x64/7za.exe';
const dest = path.join(process.cwd(), 'build', '7za.exe');

if (!fs.existsSync(dest)) {
  console.log(`Downloading 7za.exe from ${url}...`);
  const file = fs.createWriteStream(dest);
  https.get(url, function(response) {
    response.pipe(file);
    file.on('finish', function() {
      file.close();
      console.log('7za.exe downloaded successfully.');
    });
  }).on('error', function(err) {
    fs.unlink(dest, () => {});
    console.error('Error downloading 7za.exe:', err.message);
    process.exit(1);
  });
} else {
  console.log('7za.exe already exists.');
}
