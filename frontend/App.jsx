import React,{useEffect,useState} from 'react';
import {io} from 'socket.io-client';

const API='http://localhost:4000/api';
function App(){
 const [token,setToken]=useState(localStorage.getItem('token')||'');
 const [user,setUser]=useState(null),[tenants,setTenants]=useState([]),[tenantId,setTenantId]=useState('');
 const [boards,setBoards]=useState([]),[boardId,setBoardId]=useState('');
 const [board,setBoard]=useState(null),[presence,setPresence]=useState([]),[activity,setActivity]=useState([]);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState('');
 const [org,setOrg]=useState('My Organization'),[branch,setBranch]=useState('Main Branch');
 const [newBoard,setNewBoard]=useState('My Kanban Board'),[newTask,setNewTask]=useState({});
 const [selected,setSelected]=useState(null),[message,setMessage]=useState('');
 const [history,setHistory]=useState([]),[future,setFuture]=useState([]);

 async function api(path,options={}){
  const r=await fetch(API+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(options.headers||{})}});
  const data=await r.json(); if(!r.ok) throw Object.assign(new Error(data.error||'Request failed'),{data,status:r.status}); return data;
 }
 async function login(e){e.preventDefault();try{const d=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});setToken(d.token);localStorage.setItem('token',d.token);setUser(d.user);setTenants(d.tenants);if(d.tenants[0])setTenantId(String(d.tenants[0].id));setMessage('Welcome back');}catch(e){setMessage(e.message)}}
 async function register(e){e.preventDefault();try{const d=await api('/auth/register',{method:'POST',body:JSON.stringify({name,email,password,organizationName:org,tenantName:branch})});setToken(d.token);localStorage.setItem('token',d.token);setUser(d.user);setTenants([{id:d.tenant.id,name:d.tenant.name,role:'org_admin'}]);setTenantId(String(d.tenant.id));setMessage('Account created');}catch(e){setMessage(e.message)}}
 async function loadTenants(){
  const d = await api('/tenants');
  setTenants(d);
  if(!tenantId && d[0]){
    setTenantId(String(d[0].id));
  }
}
 async function loadBoards(){if(!tenantId)return;const d=await api('/boards?tenantId='+tenantId);setBoards(d);if(d[0])setBoardId(String(d[0].id));else setBoard(null);}
 async function loadBoard(id=boardId){if(!id||!tenantId)return;const d=await api(`/boards/${id}?tenantId=${tenantId}`);setBoard(d);}
 async function loadActivity(){if(tenantId)try{setActivity(await api('/activity?tenantId='+tenantId))}catch{}}
 useEffect(()=>{if(token){api('/auth/me').then(d=>setUser(d.user)).catch(()=>logout());loadTenants().catch(()=>{});}},[token]);
 useEffect(()=>{if(token&&tenantId){loadBoards().catch(e=>setMessage(e.message));loadActivity();}},[token,tenantId]);
 useEffect(()=>{if(token&&tenantId){const s=io('http://localhost:4000',{auth:{token}});s.on('presence:update',d=>{if(String(d.tenantId)===String(tenantId))setPresence(d.users)});['task:created','task:updated','task:moved','task:deleted','board:changed'].forEach(ev=>s.on(ev,()=>{loadBoard();loadActivity()}));return()=>s.disconnect();}},[token,tenantId,boardId]);
 useEffect(()=>{if(boardId&&tenantId)loadBoard(boardId).catch(()=>{});},[boardId,tenantId]);
 function logout(){localStorage.removeItem('token');setToken('');setUser(null);setTenantId('');setBoard(null);}
 async function createBoard(){try{const b=await api('/boards',{method:'POST',body:JSON.stringify({tenantId:Number(tenantId),name:newBoard})});setBoards([b,...boards]);setBoardId(String(b.id));}catch(e){setMessage(e.message)}}
 async function addTask(colId){const title=newTask[colId];if(!title?.trim())return;try{await api('/tasks',{method:'POST',body:JSON.stringify({tenantId:Number(tenantId),columnId:colId,title})});setNewTask({...newTask,[colId]:''});loadBoard();}catch(e){setMessage(e.message)}}
 async function moveTask(task,targetColumnId){const snapshot=board;setHistory([...history,{taskId:task.id,columnId:task.column_id}]);setFuture([]);setBoard({...board,columns:board.columns.map(c=>({...c,tasks:c.tasks.filter(t=>t.id!==task.id)})).map(c=>c.id===targetColumnId?{...c,tasks:[...c.tasks,{...task,column_id:targetColumnId}]}:c)});try{await api(`/tasks/${task.id}/move`,{method:'POST',body:JSON.stringify({tenantId:Number(tenantId),targetColumnId,expectedVersion:task.version})});}catch(e){setMessage(e.message+' — board refreshed');loadBoard();}}
 async function undo(){const last=history[history.length-1];if(!last||!board)return;const task=board.columns.flatMap(c=>c.tasks).find(t=>t.id===last.taskId);if(!task)return;setHistory(history.slice(0,-1));await moveTask({...task,version:task.version},last.columnId);}
 async function saveTask(){if(!selected)return;try{await api(`/tasks/${selected.id}`,{method:'PATCH',body:JSON.stringify({tenantId:Number(tenantId),title:selected.title,description:selected.description,expectedVersion:selected.version})});setSelected(null);loadBoard();}catch(e){setMessage(e.message);loadBoard();}}
 async function createTenant(){const n=prompt('New branch name');if(!n)return;try{const d=await api('/tenants',{method:'POST',body:JSON.stringify({organizationId:user.organization_id,name:n})});await loadTenants();setTenantId(String(d.id));}catch(e){setMessage(e.message)}}
 if(!token)return <main className="auth"><section className="panel"><h1>Kanban Collaboration</h1><p>Multi-organization · Multi-tenant · Real-time</p><form onSubmit={login}><h2>Sign in</h2><input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required/><button>Sign in</button></form><hr/><form onSubmit={register}><h2>Create demo organization</h2><input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} required/><input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password (6+ characters)" value={password} onChange={e=>setPassword(e.target.value)} required/><input placeholder="Organization name" value={org} onChange={e=>setOrg(e.target.value)} required/><input placeholder="First branch name" value={branch} onChange={e=>setBranch(e.target.value)} required/><button>Create account</button></form>{message&&<p className="notice">{message}</p>}</section></main>;
 return <div className="app"><header><div><h1>Aruna Kanban</h1><small>Real-time collaborative task board</small></div><div className="user">{user?.name} <button className="secondary" onClick={logout}>Logout</button></div></header>
 <aside><label>Organization</label><div className="org">{user?.organization_id||'My Organization'}</div><label>Branch / Tenant</label><select value={tenantId} onChange={e=>setTenantId(e.target.value)}>{tenants.map(t=><option key={t.id} value={t.id}>{t.name} · {t.role}</option>)}</select><button className="secondary" onClick={createTenant}>+ Add branch</button><label>Board</label><select value={boardId} onChange={e=>setBoardId(e.target.value)}>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><input value={newBoard} onChange={e=>setNewBoard(e.target.value)} placeholder="New board name"/><button onClick={createBoard}>+ Create board</button><label>Online in tenant</label><div className="presence">{presence.map((p,i)=><span key={i}>{p.name}</span>)}</div><label>Recent activity</label><div className="activity">{activity.slice(0,8).map(a=><p key={a.id}>{a.user_name} {a.action} {a.entity_type}: {a.details}</p>)}</div></aside>
 <main className="workspace"><div className="toolbar"><h2>{board?.name||'Select or create a board'}</h2><div><button className="secondary" onClick={undo} disabled={!history.length}>Undo last move</button><button
  className="secondary"
  onClick={async()=>{
    try{
      await loadBoards();
      await loadBoard();
      await loadActivity();
      setMessage('Board refreshed successfully');
    }catch(e){
      setMessage('Refresh failed: '+e.message);
    }
  }}
>
  Refresh
</button></div></div>
 {!board?<p>Create a board to get started.</p>:<div className="columns">{board.columns.map(col=><section className="column" key={col.id} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData('task');if(raw)moveTask(JSON.parse(raw),col.id)}}><h3>{col.name} <small>{col.tasks.length}</small></h3><div className="add"><input placeholder="Add a task..." value={newTask[col.id]||''} onChange={e=>setNewTask({...newTask,[col.id]:e.target.value})} onKeyDown={e=>e.key==='Enter'&&addTask(col.id)}/><button onClick={()=>addTask(col.id)}>+</button></div>{col.tasks.map(task=><article className="task" key={task.id} draggable onDragStart={e=>e.dataTransfer.setData('task',JSON.stringify(task))}><b>{task.title}</b><p>{task.description||'No description'}</p><small>Version {task.version}</small><button className="link" onClick={()=>setSelected({...task})}>Open details</button></article>)}</section>)}</div>}
 </main>
 {selected&&<div className="overlay"><section className="detail"><button className="close" onClick={()=>setSelected(null)}>×</button><h2>Task details</h2><label>Title</label><input value={selected.title} onChange={e=>setSelected({...selected,title:e.target.value})}/><label>Description</label><textarea value={selected.description||''} onChange={e=>setSelected({...selected,description:e.target.value})}/><p>Version: {selected.version}</p><button onClick={saveTask}>Save changes</button><button className="danger" onClick={async()=>{await api(`/tasks/${selected.id}?tenantId=${tenantId}`,{method:'DELETE'});setSelected(null);loadBoard()}}>Delete task</button></section></div>}
 {message&&<div className="toast" onClick={()=>setMessage('')}>{message} ×</div>}
 </div>;
}
export default App;
