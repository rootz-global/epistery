import express from 'express';
import Epistery from '../index.mjs';
import path from "path";

async function main() {
    const app = express();

    const epistery = await Epistery.connect()
    await epistery.attach(app);

    app.get('/', (req, res) => {
        res.sendFile(path.resolve('test/index.html'));
    })

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`running on port ${port}`);
    });
}

main().catch(err => {
    console.error('failed', err);
    process.exit(1);
});
