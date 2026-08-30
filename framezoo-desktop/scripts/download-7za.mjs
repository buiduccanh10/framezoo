import fs from 'fs';
import https from 'https';
import path from 'path';

const url = 'https://github.com/develar/7zip-bin/raw/master/win/ia32/7za.exe';
const dest = path.join(process.cwd(), 'build', '7za.dat');

if (!fs.existsSync(dest)) {
  console.log(`Downloading 32-bit 7za.dat from ${url}...`);
  const file = fs.createWriteStream(dest);
  https.get(url, function(response) {
    if (response.statusCode === 302 && response.headers.location) {
        https.get(response.headers.location, function(res2) {
            res2.pipe(file);
            file.on('finish', function() {
              file.close();
              console.log('7za.dat downloaded successfully.');
            });
        }).on('error', function(err) {
            fs.unlink(dest, () => {});
            console.error('Error downloading 7za.dat:', err.message);
            process.exit(1);
        });
        return;
    }
    response.pipe(file);
    file.on('finish', function() {
      file.close();
      console.log('7za.dat downloaded successfully.');
    });
  }).on('error', function(err) {
    fs.unlink(dest, () => {});
    console.error('Error downloading 7za.dat:', err.message);
    process.exit(1);
  });
} else {
  console.log('7za.dat already exists.');
}
