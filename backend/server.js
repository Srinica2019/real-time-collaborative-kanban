require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http');
const {Server} = require('socket.io');
const jwt = require('jsonwebtoken');
const {run,get,all} = require('./db');
const {sign,authenticate,tenantAccess,requireAdmin,secret} = require('./auth');

const app = express();
app.use(cors({origin:process.env.CLIENT_ORIGIN || 'http://localhost:5173'}));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server,{cors:{origin:process.env.CLIENT_ORIGIN || 'http://localhost:5173'}});

async function log(tenantId,userId,action,type,id,details='') {
  await run('INSERT INTO activity_logs(tenant_id,user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?,?)',
    [tenantId,userId,action,type,id,details]);
}
function broadcast(tenantId,event,payload) { io.to(`tenant:${tenantId}`).emit(event,payload); }

app.get('/api/health',(req,res)=>res.json({status:'ok'}));

app.post('/api/auth/register',async(req,res,next)=>{
  try {
    const {name,email,password,organizationName,tenantName}=req.body;
    if(!name||!email||!password||!organizationName||!tenantName) return res.status(400).json({error:'All fields are required'});
    if(password.length<6) return res.status(400).json({error:'Password must be at least 6 characters'});
    if(await get('SELECT id FROM users WHERE email=?',[email.toLowerCase()])) return res.status(409).json({error:'Email already registered'});
    const org=await run('INSERT INTO organizations(name) VALUES(?)',[organizationName]);
    const tenant=await run('INSERT INTO tenants(organization_id,name) VALUES(?,?)',[org.lastID,tenantName]);
    const hash=await bcrypt.hash(password,10);
    const user=await run('INSERT INTO users(organization_id,name,email,password_hash) VALUES(?,?,?,?)',[org.lastID,name,email.toLowerCase(),hash]);
    await run('INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)',[user.lastID,tenant.lastID,'org_admin']);
    const row={id:user.lastID,name,email:email.toLowerCase(),organization_id:org.lastID};
    res.json({token:sign(row),user:{id:row.id,name:row.name,email:row.email},organization:{id:org.lastID,name:organizationName},tenant:{id:tenant.lastID,name:tenantName}});
  } catch(e){next(e);}
});
app.post('/api/auth/login',async(req,res,next)=>{
  try {
    const {email,password}=req.body;
    const user=await get('SELECT * FROM users WHERE email=?',[String(email||'').toLowerCase()]);
    if(!user||!await bcrypt.compare(password||'',user.password_hash)) return res.status(401).json({error:'Invalid email or password'});
    const tenants=await all(`SELECT t.id,t.name,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=?`,[user.id]);
    res.json({token:sign(user),user:{id:user.id,name:user.name,email:user.email},tenants});
  }catch(e){next(e);}
});
app.get('/api/auth/me',authenticate,async(req,res,next)=>{
  try { const user=await get('SELECT id,name,email,organization_id FROM users WHERE id=?',[req.user.id]); res.json({user}); }catch(e){next(e);}
});

app.use('/api',authenticate);

app.get('/api/organizations',async(req,res,next)=>{
  try {res.json(await all('SELECT id,name,created_at FROM organizations WHERE id=?',[req.user.organizationId]));}catch(e){next(e);}
});
app.post('/api/organizations',async(req,res,next)=>{
  try {const r=await run('INSERT INTO organizations(name) VALUES(?)',[req.body.name]);res.status(201).json(await get('SELECT * FROM organizations WHERE id=?',[r.lastID]));}catch(e){next(e);}
});
app.get('/api/tenants',async(req,res,next)=>{
  try {res.json(await all(`SELECT t.id,t.name,t.organization_id,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? AND t.organization_id=?`,[req.user.id,req.user.organizationId]));}catch(e){next(e);}
});
app.post('/api/tenants',async(req,res,next)=>{
  try {
    const {organizationId,name}=req.body;
    if(Number(organizationId)!==req.user.organizationId) return res.status(403).json({error:'Cross-organization access denied'});
    const role=await get(`SELECT m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND t.organization_id=? AND m.role='org_admin'`,[req.user.id,req.user.organizationId]);
    if(!role) return res.status(403).json({error:'Organization admin required'});
    const r=await run('INSERT INTO tenants(organization_id,name) VALUES(?,?)',[organizationId,name]);
    await run('INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)',[req.user.id,r.lastID,'org_admin']);
    res.status(201).json({id:r.lastID,name,organization_id:organizationId});
  }catch(e){next(e);}
});
app.get('/api/tenants/:tenantId/members',tenantAccess,async(req,res,next)=>{
  try {res.json(await all(`SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=?`,[req.tenantId]));}catch(e){next(e);}
});
app.post('/api/tenants/:tenantId/members',tenantAccess,requireAdmin,async(req,res,next)=>{
  try {
    const {email,role='member'}=req.body;
    if(!['tenant_admin','member'].includes(role)) return res.status(400).json({error:'Invalid role'});
    const user=await get('SELECT id,organization_id FROM users WHERE email=?',[String(email||'').toLowerCase()]);
    if(!user||user.organization_id!==req.user.organizationId) return res.status(404).json({error:'User not found in this organization'});
    await run('INSERT OR REPLACE INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)',[user.id,req.tenantId,role]);
    res.status(201).json({success:true});
  }catch(e){next(e);}
});

app.get('/api/boards',tenantAccess,async(req,res,next)=>{
  try {res.json(await all('SELECT * FROM boards WHERE tenant_id=? ORDER BY id DESC',[req.tenantId]));}catch(e){next(e);}
});
app.post('/api/boards',tenantAccess,async(req,res,next)=>{
  try {
    const r=await run('INSERT INTO boards(tenant_id,name) VALUES(?,?)',[req.tenantId,req.body.name||'My Board']);
    for(const [i,n] of ['To Do','In Progress','Done'].entries()) await run('INSERT INTO columns(tenant_id,board_id,name,position) VALUES(?,?,?,?)',[req.tenantId,r.lastID,n,i]);
    await log(req.tenantId,req.user.id,'created','board',r.lastID,req.body.name||'My Board');
    broadcast(req.tenantId,'board:changed',{action:'created',boardId:r.lastID});
    res.status(201).json(await get('SELECT * FROM boards WHERE id=? AND tenant_id=?',[r.lastID,req.tenantId]));
  }catch(e){next(e);}
});
app.get('/api/boards/:boardId',tenantAccess,async(req,res,next)=>{
  try {
    const board=await get('SELECT * FROM boards WHERE id=? AND tenant_id=?',[req.params.boardId,req.tenantId]);
    if(!board) return res.status(404).json({error:'Board not found'});
    const columns=await all('SELECT * FROM columns WHERE board_id=? AND tenant_id=? ORDER BY position',[board.id,req.tenantId]);
    for(const c of columns) c.tasks=await all('SELECT * FROM tasks WHERE column_id=? AND tenant_id=? ORDER BY position',[c.id,req.tenantId]);
    res.json({...board,columns});
  }catch(e){next(e);}
});
app.post('/api/boards/:boardId/columns',tenantAccess,async(req,res,next)=>{
  try {
    const board=await get('SELECT id FROM boards WHERE id=? AND tenant_id=?',[req.params.boardId,req.tenantId]);
    if(!board) return res.status(404).json({error:'Board not found'});
    const pos=await get('SELECT COALESCE(MAX(position),-1)+1 AS p FROM columns WHERE board_id=? AND tenant_id=?',[board.id,req.tenantId]);
    const r=await run('INSERT INTO columns(tenant_id,board_id,name,position) VALUES(?,?,?,?)',[req.tenantId,board.id,req.body.name,pos.p]);
    broadcast(req.tenantId,'board:changed',{action:'column-created'});
    res.status(201).json(await get('SELECT * FROM columns WHERE id=?',[r.lastID]));
  }catch(e){next(e);}
});
app.post('/api/tasks',tenantAccess,async(req,res,next)=>{
  try {
    const {columnId,title,description=''}=req.body;
    const col=await get('SELECT id FROM columns WHERE id=? AND tenant_id=?',[columnId,req.tenantId]);
    if(!col) return res.status(404).json({error:'Column not found'});
    const p=await get('SELECT COALESCE(MAX(position),-1)+1 AS p FROM tasks WHERE column_id=? AND tenant_id=?',[columnId,req.tenantId]);
    const r=await run('INSERT INTO tasks(tenant_id,column_id,title,description,position) VALUES(?,?,?,?,?)',[req.tenantId,columnId,title,description,p.p]);
    await log(req.tenantId,req.user.id,'created','task',r.lastID,title);
    const task=await get('SELECT * FROM tasks WHERE id=? AND tenant_id=?',[r.lastID,req.tenantId]);
    broadcast(req.tenantId,'task:created',{task});
    res.status(201).json(task);
  }catch(e){next(e);}
});
app.patch('/api/tasks/:taskId',tenantAccess,async(req,res,next)=>{
  try {
    const old=await get('SELECT * FROM tasks WHERE id=? AND tenant_id=?',[req.params.taskId,req.tenantId]);
    if(!old) return res.status(404).json({error:'Task not found'});
    const {title=old.title,description=old.description,expectedVersion}=req.body;
    if(expectedVersion===undefined) return res.status(400).json({error:'expectedVersion is required'});
    const result=await run(`UPDATE tasks SET title=?,description=?,version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=? AND version=?`,[title,description,old.id,req.tenantId,expectedVersion]);
    if(!result.changes) return res.status(409).json({error:'Conflict: task was changed by another user',latest:await get('SELECT * FROM tasks WHERE id=? AND tenant_id=?',[old.id,req.tenantId])});
    const task=await get('SELECT * FROM tasks WHERE id=? AND tenant_id=?',[old.id,req.tenantId]);
    await log(req.tenantId,req.user.id,'updated','task',task.id,title);
    broadcast(req.tenantId,'task:updated',{task});
    res.json(task);
  }catch(e){next(e);}
});
app.post('/api/tasks/:taskId/move',tenantAccess,async(req,res,next)=>{
  try {
    const task=await get('SELECT * FROM tasks WHERE id=? AND tenant_id=?',[req.params.taskId,req.tenantId]);
    if(!task) return res.status(404).json({error:'Task not found'});
    const {targetColumnId,expectedVersion}=req.body;
    const col=await get('SELECT id FROM columns WHERE id=? AND tenant_id=?',[targetColumnId,req.tenantId]);
    if(!col) return res.status(404).json({error:'Target column not found'});
    if(expectedVersion!==task.version) return res.status(409).json({error:'Conflict: task changed',latest:task});
    const p=await get('SELECT COALESCE(MAX(position),-1)+1 AS p FROM tasks WHERE column_id=? AND tenant_id=?',[targetColumnId,req.tenantId]);
    const result=await run(`UPDATE tasks SET column_id=?,position=?,version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=? AND version=?`,[targetColumnId,p.p,task.id,req.tenantId,expectedVersion]);
    if(!result.changes) return res.status(409).json({error:'Conflict: task changed',latest:await get('SELECT * FROM tasks WHERE id=?',[task.id])});
    const moved=await get('SELECT * FROM tasks WHERE id=? AND tenant_id=?',[task.id,req.tenantId]);
    await log(req.tenantId,req.user.id,'moved','task',task.id,`column ${task.column_id} -> ${targetColumnId}`);
    broadcast(req.tenantId,'task:moved',{task:moved});
    res.json(moved);
  }catch(e){next(e);}
});
app.delete('/api/tasks/:taskId',tenantAccess,async(req,res,next)=>{
  try {
    const task=await get('SELECT * FROM tasks WHERE id=? AND tenant_id=?',[req.params.taskId,req.tenantId]);
    if(!task) return res.status(404).json({error:'Task not found'});
    await run('DELETE FROM tasks WHERE id=? AND tenant_id=?',[task.id,req.tenantId]);
    await log(req.tenantId,req.user.id,'deleted','task',task.id,task.title);
    broadcast(req.tenantId,'task:deleted',{taskId:task.id});
    res.json({success:true});
  }catch(e) {
    next(e);
  }
});
app.get('/api/activity',tenantAccess,async(req,res,next)=>{
  try {res.json(await all(`SELECT a.*,u.name AS user_name FROM activity_logs a JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 100`,[req.tenantId]));}catch(e){next(e);}
});

const presence=new Map();
io.use((socket,next)=>{
  try {
    const token=socket.handshake.auth?.token;
    if(!token) return next(new Error('Unauthorized'));
    socket.user=jwt.verify(token,secret); next();
  }catch{next(new Error('Unauthorized'));}
});
io.on('connection',async socket=>{
  const rows=await all(`SELECT tenant_id FROM memberships WHERE user_id=?`,[socket.user.id]);
  for(const row of rows){
    const room=`tenant:${row.tenant_id}`;
    socket.join(room);
    if(!presence.has(row.tenant_id)) presence.set(row.tenant_id,new Map());
    presence.get(row.tenant_id).set(socket.id,{userId:socket.user.id,name:socket.user.name});
    io.to(room).emit('presence:update',{tenantId:row.tenant_id,users:[...presence.get(row.tenant_id).values()]});
  }
  socket.on('disconnect',()=>{
    for(const row of rows){
      const map=presence.get(row.tenant_id);
      if(map){map.delete(socket.id);io.to(`tenant:${row.tenant_id}`).emit('presence:update',{tenantId:row.tenant_id,users:[...map.values()]});}
    }
  });
});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error',detail:process.env.NODE_ENV==='development'?err.message:undefined});});
const port=process.env.PORT||4000;
server.listen(port,()=>console.log(`API + Socket.IO listening on ${port}`));
