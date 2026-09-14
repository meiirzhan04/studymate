import React, {useEffect, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Scatter, ScatterChart} from 'recharts'
import './styles.css'

const api = async (path, token, options={}) => {
  const response = await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}})
  const body = await response.json()
  if(!response.ok) throw new Error(body.detail || 'Request failed')
  return body
}

function Login({onLogin}){
  const [identifier,setIdentifier]=useState('student@univ.edu'),[password,setPassword]=useState('student123'),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{onLogin(await api('/api/auth/login',null,{method:'POST',body:JSON.stringify({identifier,password})}))}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <main className="login-page"><section className="login-copy"><span className="eyebrow">STUDYMATE</span><h1>See the signal.<br/>Shape the outcome.</h1><p>One clear view of grades, attendance, deadlines, and academic risk.</p><div className="signal"><i/><span>Explainable insights</span><i/><span>Private by design</span></div></section><form className="login-card" onSubmit={submit}><div className="brand-mark">S</div><h2>Welcome back</h2><p>Sign in with your university account.</p><label>University email or Student ID<input value={identifier} onChange={e=>setIdentifier(e.target.value)}/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="error">{error}</div>}<button disabled={busy}>{busy?'Signing in…':'Sign in'}</button><div className="demo"><button type="button" onClick={()=>{setIdentifier('student@univ.edu');setPassword('student123')}}>Student demo</button><button type="button" onClick={()=>{setIdentifier('teacher@univ.edu');setPassword('teacher123')}}>Teacher demo</button></div></form></main>
}

const Metric=({label,value,detail,tone=''})=><article className={`metric ${tone}`}><span>{label}</span><strong>{value??'Unavailable'}</strong><small>{detail}</small></article>

function Student({token,user}){
 const [data,setData]=useState(),[semester,setSemester]=useState('spring-2026'),[error,setError]=useState('')
 useEffect(()=>{api(`/api/student/dashboard?semester=${semester}`,token).then(setData).catch(e=>setError(e.message))},[semester,token])
 if(error)return <div className="error">{error}</div>; if(!data)return <div className="loading">Loading your academic view…</div>
 return <><header className="page-head"><div><span className="eyebrow">STUDENT OVERVIEW</span><h1>Good evening, {user.name.split(' ')[0]}.</h1><p>Your current semester, distilled into what needs attention.</p></div><select value={semester} onChange={e=>setSemester(e.target.value)}><option value="spring-2026">Spring 2026</option><option value="fall-2025">Fall 2025</option></select></header><section className="metrics"><Metric label="Current GPA" value={data.gpa.value?.toFixed(2)} detail="Demo 4-point scale · policy pending"/><Metric label="Attendance" value={`${data.attendance.value}%`} detail="Across eligible sessions"/><Metric label="Completed credits" value={data.credits} detail={`${data.courses.length} active courses`}/><Metric label="Active alerts" value={data.alerts.length} detail={data.alerts.length?'Review recommended':'Nothing urgent'} tone={data.alerts.length?'warn':''}/></section><section className="grid"><article className="panel wide"><div className="panel-title"><div><span className="eyebrow">COURSE PERFORMANCE</span><h2>Weighted grade overview</h2></div><span className="muted">{semester.replace('-',' ')}</span></div><ResponsiveContainer width="100%" height={270}><BarChart data={data.courses}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="code"/><YAxis domain={[0,100]}/><Tooltip/><Bar dataKey="score" fill="#6657E8" radius={[8,8,0,0]}/></BarChart></ResponsiveContainer><div className="course-list">{data.courses.map(c=><div key={c.code}><span><b>{c.course}</b><small>{c.code} · {c.credits} credits</small></span><strong>{c.score==null?'Insufficient data':`${c.score}%`}</strong></div>)}</div></article><aside><article className="panel"><span className="eyebrow">ACTION CENTER</span><h2>What to focus on</h2>{data.alerts.length?data.alerts.map((a,i)=><div className="alert" key={i}><b>{a.type.replaceAll('_',' ')}</b><span>{a.detail}</span></div>):<p className="empty">No active risk signals.</p>}</article><article className="panel"><span className="eyebrow">STUDY PLAN</span><h2>Recommendations</h2>{data.recommendations.length?data.recommendations.map((r,i)=><div className="recommend" key={i}><b>{r.course}</b><p>{r.action}</p><small>{r.reason}</small></div>):<p className="empty">No targeted recommendations for this period.</p>}</article></aside></section></>
}

function Teacher({token,user}){
 const [students,setStudents]=useState(),[analytics,setAnalytics]=useState()
 useEffect(()=>{Promise.all([api('/api/teacher/students',token),api('/api/teacher/analytics/attendance-performance',token)]).then(([s,a])=>{setStudents(s.items);setAnalytics(a)})},[token])
 if(!students||!analytics)return <div className="loading">Loading authorized class data…</div>
 const atRisk=students.filter(s=>s.risk_factors.length)
 return <><header className="page-head"><div><span className="eyebrow">TEACHER OVERVIEW</span><h1>Your class signals.</h1><p>Authorized CS-2026 student performance and explainable risk factors.</p></div></header><section className="metrics"><Metric label="Students in scope" value={students.length} detail="Current authorized cohort"/><Metric label="At-risk students" value={atRisk.length} detail="Based on configured demo rules" tone={atRisk.length?'warn':''}/><Metric label="Average attendance" value={`${(students.reduce((a,s)=>a+s.attendance,0)/students.length).toFixed(1)}%`} detail="Across students in scope"/><Metric label="Correlation" value={analytics.correlation} detail="Association, not causation"/></section><section className="grid"><article className="panel wide"><div className="panel-title"><div><span className="eyebrow">AUTHORIZED STUDENTS</span><h2>Risk watchlist</h2></div></div><div className="student-table"><div className="thead"><span>Student</span><span>Attendance</span><span>Risk status</span></div>{students.map(s=><div className="trow" key={s.id}><span><b>{s.name}</b><small>{s.cohort}</small></span><strong>{s.attendance}%</strong><span>{s.risk_factors.length?s.risk_factors.map((r,i)=><em key={i}>{r.detail}</em>):<em className="good">No active signals</em>}</span></div>)}</div></article><aside><article className="panel"><span className="eyebrow">ATTENDANCE × GRADE</span><h2>Class relationship</h2><ResponsiveContainer width="100%" height={220}><ScatterChart><CartesianGrid/><XAxis dataKey="attendance" name="Attendance" unit="%" domain={[50,100]}/><YAxis dataKey="average_grade" name="Grade" unit="%" domain={[40,100]}/><Tooltip cursor={{strokeDasharray:'3 3'}}/><Scatter data={analytics.points} fill="#F07B52"/></ScatterChart></ResponsiveContainer><p className="footnote">r = {analytics.correlation}. {analytics.note}</p></article></aside></section></>
}

function App(){
 const [session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem('session'))}catch{return null}})
 const login=s=>{localStorage.setItem('session',JSON.stringify(s));setSession(s)}, logout=()=>{localStorage.removeItem('session');setSession(null)}
 if(!session)return <Login onLogin={login}/>
 return <div className="app"><nav><div className="logo">S</div><div><b>StudyMate</b><span>Performance monitor</span></div><button onClick={logout}>Sign out</button></nav><main className="content">{session.user.role==='student'?<Student token={session.access_token} user={session.user}/>:<Teacher token={session.access_token} user={session.user}/>}</main></div>
}
createRoot(document.getElementById('root')).render(<App/>)

