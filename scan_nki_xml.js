import fs from 'fs';
export function extractXmlFromBinary(buffer) {
    const view = new Uint8Array(buffer);
    const xmlStart = [0x3C, 0x3F, 0x78, 0x6D, 0x6C]; // <?xml
    const instrStart = [0x3C, 0x49, 0x6E, 0x73, 0x74, 0x72]; // <Instr

    let startIdx = -1;
    for(let i=0; i<view.length - 10; i++) {
        if (view[i] === xmlStart[0] && view[i+1] === xmlStart[1] && view[i+2] === xmlStart[2] && view[i+3] === xmlStart[3] && view[i+4] === xmlStart[4]) {
            startIdx = i;
            break;
        }
        if (view[i] === instrStart[0] && view[i+1] === instrStart[1] && view[i+2] === instrStart[2] && view[i+3] === instrStart[3] && view[i+4] === instrStart[4] && view[i+5] === instrStart[5]) {
            startIdx = i;
            break;
        }
    }

    if (startIdx !== -1) {
        // find end
        let endIdx = -1;
        // Search for "</Instrument>" or similar
        const endTag = [0x3C, 0x2F, 0x49, 0x6E, 0x73, 0x74, 0x72, 0x75, 0x6D, 0x65, 0x6E, 0x74, 0x3E]; // </Instrument>
        for (let i = startIdx; i < view.length - 15; i++) {
            let match = true;
            for (let j = 0; j < endTag.length; j++) {
                if (view[i+j] !== endTag[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                endIdx = i + endTag.length;
                break;
            }
        }
        
        if (endIdx === -1) {
            // fallback to finding first null byte after startIdx
            for (let i = startIdx; i < view.length; i++) {
                if (view[i] === 0) {
                    endIdx = i;
                    break;
                }
            }
        }

        if (endIdx !== -1) {
            const xmlBuffer = view.slice(startIdx, endIdx);
            return new TextDecoder().decode(xmlBuffer);
        }
    }
    return null;
}
console.log("extractXmlFromBinary defined");
