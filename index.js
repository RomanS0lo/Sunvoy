const fs = require('fs').promises;
const https = require('https');

const BASE_URL = 'challenge.sunvoy.com';
let cookies = {};

function makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve) => {
        let options = {
            hostname: BASE_URL,
            path: path,
            method: method,
            headers: {}
        };
        
        if (Object.keys(cookies).length > 0) {
            options.headers.Cookie = Object.entries(cookies).map(([k,v]) => k + '=' + v).join('; ');
        }
        
        if (method == 'POST') {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.headers['Content-Length'] = data ? data.length : 0;
        }
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.headers['set-cookie']) {
                    res.headers['set-cookie'].forEach(c => {
                        let parts = c.split(';')[0].split('=');
                        cookies[parts[0]] = parts[1];
                    });
                }
                resolve({
                    status: res.statusCode,
                    body: body,
                    location: res.headers.location
                });
            });
        });
        
        req.on('error', (e) => {
            console.error('Request failed:', e);
            resolve(null);
        });
        
        if (data) req.write(data);
        req.end();
    });
}

async function loadCookies() {
    try {
        const data = await fs.readFile('.credentials.json', 'utf8');
        const saved = JSON.parse(data);
        if (saved.cookies) {
            cookies = saved.cookies;
            return true;
        }
    } catch (e) {}
    return false;
}

async function saveCookies() {
    await fs.writeFile('.credentials.json', JSON.stringify({ cookies: cookies }));
}

async function login() {
    console.log('Logging in...');
    
    const loginPage = await makeRequest('/login');
    
    // extract nonce
    const nonceMatch = loginPage.body.match(/name="nonce" value="([^"]+)"/);
    const nonce = nonceMatch ? nonceMatch[1] : '';
    
    const formData = `username=demo@example.org&password=test&nonce=${nonce}`;
    const response = await makeRequest('/login', 'POST', formData);
    
    if (response.status === 302) {
        await saveCookies();
        console.log('Login successful!');
        return true;
    }
    
    return false;
}

async function getUsers() {
    // POST? weird but ok
    const response = await makeRequest('/api/users', 'POST', '');
    
    if (response && response.status === 200) {
        return JSON.parse(response.body);
    }
    return [];
}

async function getCurrentUser() {
    const response = await makeRequest('/settings');
    
    if (!response || response.status !== 200) {
        return null;
    }
    
    const html = response.body;
    
    const idMatch = html.match(/value="([a-f0-9-]{36})"/);
    const firstNameMatch = html.match(/First Name[\s\S]*?value="([^"]*)"/);
    const lastNameMatch = html.match(/Last Name[\s\S]*?value="([^"]*)"/);
    const emailMatch = html.match(/Email[\s\S]*?value="([^"]*)"/);
    
    return {
        id: idMatch ? idMatch[1] : 'unknown',
        firstName: firstNameMatch ? firstNameMatch[1] : 'John',
        lastName: lastNameMatch ? lastNameMatch[1] : 'Doe',
        email: emailMatch ? emailMatch[1] : 'demo@example.org'
    };
}

async function main() {
    const hasSavedSession = await loadCookies();
    
    if (hasSavedSession) {
        console.log('Testing saved session...');
        const testUsers = await getUsers();
        if (testUsers.length === 0) {
            console.log('Session expired');
            await login();
        } else {
            console.log('Session is valid!');
        }
    } else {
        console.log('No saved session found');
        await login();
    }
    
    console.log('Fetching users...');
    const users = await getUsers();
    console.log(`Found ${users.length} users`);
    
    console.log('Fetching current user details...');
    const currentUser = await getCurrentUser();
    
    // format output
    const output = users.map(u => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email
    }));
    
    if (currentUser) {
        const current = {
            id: currentUser.id,
            name: `${currentUser.firstName} ${currentUser.lastName}`,
            email: currentUser.email,
            isCurrent: true
        };
        
        const exists = output.find(u => u.email === current.email);
        if (!exists) {
            output.push(current);
        } else {
            exists.isCurrent = true;
        }
    }
    
    await fs.writeFile('users.json', JSON.stringify(output, null, 2));
    console.log(`\nSuccess! Saved ${output.length} users to users.json`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});