const fetch = require('node-fetch');

const API_KEY = '9bb378e0-6b46-442d-9019-96216f8e8ba7';
const BASE_URL = 'https://api.pixellab.ai/v2';

async function inspectCharacter(characterId) {
    if (!characterId) {
        console.error('Please provide a character ID as an argument.');
        process.exit(1);
    }

    console.log(`Fetching character ${characterId}...`);
    
    try {
        const response = await fetch(`${BASE_URL}/characters/${characterId}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        console.log('\n=== Character Data ===');
        console.log(`Name: ${data.name}`);
        console.log(`Status: ${data.status}`);
        console.log(`Animation Count: ${data.animation_count}`);
        
        console.log('\n=== Animations ===');
        if (data.animations && data.animations.length > 0) {
            data.animations.forEach((anim, i) => {
                console.log(`\n[${i}] ID: ${anim.id} / Template: ${anim.template_animation_id}`);
                console.log(`    Name: ${anim.name}`);
                console.log(`    Status: ${anim.status}`);
                if (anim.frame_urls) {
                    console.log(`    Frames: ${Object.keys(anim.frame_urls).join(', ')}`);
                }
            });
        } else {
            console.log('No animations found.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

const charId = process.argv[2];
insp<ctrl62><ctrl61>ectCharacter(charId);
