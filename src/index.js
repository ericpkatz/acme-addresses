import React, { Component}  from 'react';
import { render } from 'react-dom';
import { Provider, connect } from 'react-redux';
import { createStore, applyMiddleware } from 'redux';
import { HashRouter as Router, Link, Route } from 'react-router-dom';
import thunk from 'redux-thunk';
import axios from 'axios';
import logger from 'redux-logger';

//store
const reducer = (state = {}, action)=> {
  if(action.type === 'SET_AUTH'){
    state = action.auth;
  }
  return state;
};

const store = createStore(reducer, applyMiddleware(thunk, logger));

const _setAuth = (auth)=> {
  return {
    auth,
    type: 'SET_AUTH'
  };
};

const exchangeTokenForAuth = (history)=> {
  return (dispatch)=> {
    const token = window.localStorage.getItem('token');
    if(!token){
      return 
    }
    return axios.get('/api/auth', {
      headers: {
        authorization: token
      }
    })
    .then( response => response.data)
    .then( auth => {
      dispatch(_setAuth(auth));
      if(auth.is_admin){
        return axios.get('/api/users', {
          headers: {
            authorization: token
          }
        })
        .then(response => response.data)
        .then( users => {
          users.forEach( user => console.log(user));
        })
      }
      
    }) 
    .catch( ex => window.localStorage.removeItem('token'))
  }
}

const createAddress = (address)=> {
  return (dispatch, getState)=> {
    const token = window.localStorage.getItem('token');
    const auth = getState();
    return axios.post(`/api/users/${auth.id}/addresses`, {
      json: address
    }, {
      headers: {
        authorization: token
      }
    })
    .then( () => {
      dispatch(exchangeTokenForAuth());
    }) 
  }
}

const deleteAddress = (address)=> {
  return (dispatch, getState)=> {
    const token = window.localStorage.getItem('token');
    const auth = getState();
    return axios.delete(`/api/users/${auth.id}/addresses/${address.id}`,{
      headers: {
        authorization: token
      }
    })
    .then( () => {
      dispatch(exchangeTokenForAuth());
    }) 
  }
}

const logout = ()=> {
  window.localStorage.removeItem('token');
  return _setAuth({});
}

//end store


//components
class AddressInput extends Component{
  componentDidMount(){
    this.el.innerHTML = `<input class='form-control' id='autocomplete'/>`;
    const input = document.getElementById('autocomplete');
        const autocomplete = new google.maps.places.Autocomplete(
            input,
            {types: ['geocode']});

        autocomplete.addListener('place_changed', (place)=>{
          this.props.createAddress(JSON.stringify(autocomplete.getPlace()));
          input.value = '';
        });
  }
  render(){
    return <div ref={ el=> this.el = el }/>;
  }
}

class _LoggedIn extends Component{
  constructor(){
    super();
    this.createAddress = this.createAddress.bind(this);
    this.deleteAddress = this.deleteAddress.bind(this);
  }
  deleteAddress(address){
    this.props.deleteAddress(address);
  }
  createAddress(address){
    this.props.createAddress(address);
  }
  render(){
    const { user, logout } = this.props;
    const { createAddress, deleteAddress } = this;
  return (
      <div>
      <h1>Welcome { user.name }</h1>
      <button onClick={()=> logout()} className='btn btn-danger'>Logout</button>
      <hr />
      <AddressInput createAddress={ createAddress }/>
      <ul className='list-group'>
      {
        user.addresses.map( address => {
          return (
              <li key={ address.id } className='list-group-item'>
              {
                address.json.formatted_address
              }
              <button onClick={()=> deleteAddress(address)} style={{ float: 'right' }} className='btn btn-warning'>x</button>
              </li>
              );
        })

      }
      </ul>
      </div>
  );
}
}


const Login = ()=> {
  return (
      <div>
      <a className='btn btn-primary' href='/api/auth/github'>Login to Github to Create an Address Book!</a>
      </div>
  );
};

class _App extends Component{
  componentDidMount(){
    this.props.login();
  }
  render(){
    const { user } = this.props;
    return (
      <Router>
      {
        user.id ? (
            <Route component={ LoggedIn } />
            ): (
            <Route component={ Login } />
            )

      }
      </Router>
    );
  }
}

//connected components

const LoggedIn = connect(
    state => ({ user: state}),
    dispatch => ({
      logout: ()=> dispatch(logout()),
      createAddress: (address)=> dispatch(createAddress(address)),
      deleteAddress: (address)=> dispatch(deleteAddress(address))
    })
    )(_LoggedIn); 



const App = connect(
    state => ({ user: state }),
    dispatch => ({
        login: ()=> dispatch(exchangeTokenForAuth())
    })
    )(_App);

const root = document.getElementById('root');
render(<Provider store={ store }><App /></Provider>, root);


