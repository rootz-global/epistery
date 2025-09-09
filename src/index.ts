import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { Utils } from '@utils';
import { CreateController } from '@controllers/create/CreateController';
import { StatusController } from '@controllers/status/StatusController';
import { WriteController } from '@controllers/write/WriteController';


const app = express();
const PORT = process.env.PORT || 3000;

// init server-side wallet that reads from HOME/.data-wallet
const domain: string = (process.env.SERVER_DOMAIN) as string;
Utils.InitServerWallet(domain);

app.use(express.json());
app.use(cookieParser());

const createController = new CreateController();
const statusController = new StatusController();
const writeController = new WriteController();

app.get('/.epistery/status', statusController.index.bind(statusController));
app.get('/.epistery/create', createController.index.bind(createController));
app.post('/.epistery/data/write', writeController.index.bind(writeController));

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Available routes:');
  console.log('  GET  /.epistery/status');
  console.log('  GET  /.epistery/create');
  console.log('  GET  /.epistery/write');
  console.log('  POST /.epistery/data/write');
});
