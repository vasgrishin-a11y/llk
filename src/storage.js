export const storage={get(k,f){try{return JSON.parse(localStorage.getItem('dashboard_'+k))??f}catch{return f}},set(k,v){try{localStorage.setItem('dashboard_'+k,JSON.stringify(v))}catch{}}};
