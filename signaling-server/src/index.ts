import 'dotenv/config';
import SignalingServer from './server';
import { defaultConfig } from './types';

const server = new SignalingServer(defaultConfig);
server.start();
