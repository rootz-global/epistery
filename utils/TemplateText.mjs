import {readFileSync} from "fs";

export default class TemplateText {
    constructor(template) {
        this.template = template;
    }
    parse(data) {
        return this.template.replace(/\{\{([a-zA-Z0-9.]*)\}\}/g,(match, reference) => {
            return reference.split('.').reduce((acc, key) => {
                return acc && acc[key] !== undefined ? acc[key] : undefined;
            }, data);
        })
    }
    static get File() {
        return File;
    };
}

class File extends TemplateText {
    constructor(filePath) {
        super("");
        let fileData = readFileSync(filePath, 'utf8');
        this.template = fileData.toString();
    }
}