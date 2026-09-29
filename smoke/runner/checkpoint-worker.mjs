import {dataDirectory} from './files.mjs';
import {connect} from './store.mjs';
import {continueCheckpoint} from '../desktop/checkpoint.mjs';
const index=process.argv.indexOf('--run-id'),id=index>=0?process.argv[index+1]:null;
if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('An admitted checkpoint run ID is required.');
const data=dataDirectory(),db=connect(data);
try{await continueCheckpoint(db,id,data);}finally{db.close();}
