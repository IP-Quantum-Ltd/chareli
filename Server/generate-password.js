import bcrypt from 'bcrypt';

const hash = await bcrypt.hash('StrongInitialPassword123!', 12);
console.log(hash);
