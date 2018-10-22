const express = require('express');
const app = express();
const path = require('path');
const ejs = require('ejs');
const Sequelize = require('sequelize');
const jwt = require('jwt-simple');
const conn = new Sequelize(process.env.DATABASE_URL);
const axios = require('axios');
const queryString = require('query-string');

//environment variables for development
try{
  Object.assign(process.env, require('./.env'));
}
catch(ex){
  console.log(ex);
}

//models
const User = conn.define('user', {
  id: {
    primaryKey: true,
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4
  },
  name: Sequelize.STRING,
  githubUserId: Sequelize.INTEGER,
  is_admin: {
    type: Sequelize.BOOLEAN,
    defaultValue: false
  }
});

User.login = async function(code){
  try{
    let response = await axios.post('https://github.com/login/oauth/access_token', {
          code,
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          redirect_uri: process.env.GITHUB_REDIRECT_URI,
        });
    const parsed = queryString.parse(response.data);
    const { error, access_token } = parsed;
    if(error){
      throw ({ message: error })
    }
    response = await axios.get(`https://api.github.com/user?access_token=${ access_token }`);
    const { id, login } = response.data;
    const attr = {
      githubUserId: id
    };
    let user = await User.findOne({ where: attr });
    if(!user){
      attr.name = `${ login }`;
      user = await User.create(attr);
    }
    const isAdmin = !!process.env.GITHUB_ADMINS && process.env.GITHUB_ADMINS.split('|').includes(user.name);
    if(user.is_admin !== isAdmin){
      user.is_admin = isAdmin;
      await user.save();
    }
    return jwt.encode({ id: user.id}, process.env.JWT_SECRET);
  }
  catch(ex){
    throw ex;
  }
}

const Address = conn.define('address', {
  id: {
    primaryKey: true,
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4
  },
  json: {
    type: Sequelize.JSONB,
    defaultValue: {}
  }
});

User.hasMany(Address);
Address.belongsTo(User);

app.use(require('body-parser').json());
app.engine('html', ejs.renderFile);


//static routes
app.use('/dist', express.static(path.join(__dirname, 'dist')));

app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));

//middleware to find user from token
app.use((req, res, next)=> {
  const token = req.headers.authorization;
  if(!token){
    return next();
  }
  let id;
  try{
    id = jwt.decode(token, process.env.JWT_SECRET).id;
  }
  catch(ex){
    return next({ status: 401 });
  }
  User.findById(id, { include: [Address]})
    .then( user => {
      req.user = user;
      next();
    })
    .catch(next);
});

//security middleware
const loggedIn = (req, res, next)=> {
  next(req.user ? null : { status: 401 });
};

const isAdmin = (req, res, next)=> {
  next(req.user && req.user.is_admin ? null : { status: 401 });
};

const isMe = (paramKey)=> {
  return (req, res, next)=> {
    next(req.user.isAdmin || req.user.id === req.params[paramKey] ? null : {
      status: 401
    });
  };
}; 

app.get('/', async(req, res, next)=> {
  res.render(path.join(__dirname, 'index.html'), {
    token: req.query.token,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY
  });
});

//github oauth routes
app.get('/api/auth/github', (req, res, next)=> {
  const params = {
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_REDIRECT_URI
  };
  const url = `https://github.com/login/oauth/authorize?${ queryString.stringify(params)}`;
  res.redirect(url);
});

app.get('/api/auth/github/callback', (req, res, next)=> {
  User.login(req.query.code)
    .then( token => res.redirect(`/?token=${token}`))
    .catch(next);
});

//me route
app.get('/api/auth', (req, res, next)=> {
  if(!req.user){
    return next({ status: 401 });
  }
  res.send(req.user);
});

//address routes
app.post('/api/users/:userId/addresses', loggedIn, isMe('userId'), (req, res, next)=> {
  Address.create({ json: JSON.parse(req.body.json)})
    .then(address=> {
      return address.setUser(req.user)
    })
    .then(address=> res.send(address))
    .catch(next);
});

app.delete('/api/users/:userId/addresses/:id', loggedIn, isMe('userId'), (req, res, next)=> {
  Address.destroy({
    where: {
      id: req.params.id
    }
  })
    .then(()=> res.sendStatus(204))
    .catch(next);
});

app.get('/api/users', isAdmin, (req, res,next)=> {
  User.findAll({
    include: [ Address ]
  })
  .then( users => res.send(users))
  .catch(next);
});

app.get('/api/auth', (req, res, next)=> {
  if(!req.user){
    return next({ status: 401 });
  }
  res.send(req.user);
});

app.use((err, req, res, next)=> {
  res.status(err.status || 500).send({ error: err. message });
});


const port = process.env.PORT || 3000;

app.listen(port);

if(process.env.SYNC){
  conn.sync({ force: true })
    .then( ()=> User.create({ name: 'moe' }))
    .then( user => Address.create({ userId: user.id, json: require('./_sampleAddress')}));
}
else {
  const query = `
    DO
$$
BEGIN
IF not EXISTS (SELECT column_name 
               FROM information_schema.columns 
               WHERE table_schema='public' and table_name='users' and column_name='is_admin') THEN
alter table users add column is_admin boolean default false ;
else
raise NOTICE 'Already exists';
END IF;
END
$$
  `;
  conn.authenticate()
    .then(()=> {
      return conn.query(query);
    })
}

