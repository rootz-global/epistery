/**
 * The Epistery is the global store of knowledge. Insert anything, recall it with provenance, reputation and history.
 * The backbone is IPFS. The epistery puts a common interface to get, put and search.
 */
import express from 'express';

export default class Epistery {
    constructor(config) {
        this.config = config || {};
    }
    routes() {
        let router = express.Router();
        router.get('/data/:id', (req, res) => {
            res.send(req.params.id);
        })
        router.post('/data/:id', (req, res) => {
            console.log(JSON.toString(req.body))
            res.send(req.params.id);
        })
        router.get('/data/search', (req, res) => {
            res.send(req.query.q);
        })
        router.get('/data', (req, res) => {
            res.status(200).json({status: 'ok',wallet:''});
        })
        return router;
    }
}