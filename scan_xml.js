import fs from 'fs';

function extractXml(buffer) {
    const view = new Uint8Array(buffer);
    // search for "<Instr" (3C 49 6E 73 74 72)
    const xmlStart = [0x3C, 0x49, 0x6E, 0x73, 0x74, 0x72];
    for(let i=0; i<view.length - 6; i++) {
        let match = true;
        for(let j=0; j<6; j++) {
            if(view[i+j] !== xmlStart[j]) {
                match = false;
                break;
            }
        }
        if(match) {
            // Find end of XML or a reasonable length
            let end = i;
            // look for "</Instr"
            // actually just return the rest of the string and let the xml parser handle it, or find "</Instrument>"
        }
    }
}
